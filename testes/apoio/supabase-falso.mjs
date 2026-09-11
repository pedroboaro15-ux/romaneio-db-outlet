/**
 * Um Supabase de mentira, em memória.
 *
 * Por que existe: os testes precisam exercitar a DECISÃO das funções — quem pode
 * o quê, o que é aceito, o que é recusado — e não o Postgres. Subir banco pra
 * isso deixaria a bateria lenta o bastante pra ninguém rodar, e teste que
 * ninguém roda não protege nada.
 *
 * Ele imita só o punhado de métodos que o código usa de verdade. Se você usar um
 * método novo no código e ele não existir aqui, o teste quebra com "não é uma
 * função" — o que é o aviso certo pra vir acrescentar aqui.
 */

/** Compara como o PostgREST: igualdade frouxa entre número e texto do mesmo valor. */
const igual = (a, b) => a === b || (a != null && b != null && String(a) === String(b));

/** Lê "cliente->>codigo" de uma linha (o operador jsonb do PostgREST). */
function valorDoCampo(linha, campo) {
  const seta = campo.split('->>');
  if (seta.length === 2) {
    const obj = linha[seta[0].trim()];
    return obj ? obj[seta[1].trim()] : undefined;
  }
  return linha[campo];
}

/**
 * Quebra "id, nome, romaneios(freteiro_id, freteiros(nome))" em:
 *   { campos: ['id','nome'], juncoes: [{ nome:'romaneios', dentro:'freteiro_id, freteiros(nome)' }] }
 *
 * O PostgREST chama isso de "embed": pedir a tabela vizinha junto, na mesma
 * consulta. O código usa bastante, então o banco de mentira precisa entender.
 */
function separarSelect(cols) {
  const campos = [];
  const juncoes = [];
  let atual = '';
  let profundidade = 0;
  let nomeJuncao = null;

  for (const c of String(cols || '*')) {
    if (c === '(') {
      if (profundidade === 0) { nomeJuncao = atual.trim(); atual = ''; profundidade++; continue; }
      profundidade++;
    } else if (c === ')') {
      profundidade--;
      if (profundidade === 0) { juncoes.push({ nome: nomeJuncao, dentro: atual }); atual = ''; nomeJuncao = null; continue; }
    } else if (c === ',' && profundidade === 0) {
      if (atual.trim()) campos.push(atual.trim());
      atual = '';
      continue;
    }
    atual += c;
  }
  if (atual.trim() && profundidade === 0) campos.push(atual.trim());
  return { campos, juncoes };
}

/** "romaneios" -> "romaneio". O bastante pros nomes que este projeto usa. */
const singular = t => (t.endsWith('s') ? t.slice(0, -1) : t);

export function criarSupabaseFalso() {
  const banco = {
    /** { nomeDaTabela: [linha, ...] } */
    tabelas: {},
    /** { token: { id, email } } — o que o auth.getUser(token) responde */
    usuarios: {},
    /** arquivos enviados pro storage: { balde, caminho, tamanho, tipo } */
    arquivos: [],
    /** toda chamada que chegou, pra poder verificar o que a função tentou fazer */
    chamadas: []
  };

  const linhasDe = nome => (banco.tabelas[nome] ||= []);

  /**
   * Resolve os embeds de uma linha, como o PostgREST faria.
   *
   * Duas direções, decididas pela chave estrangeira:
   *   - a linha aponta pra lá (paradas.romaneio_id) -> devolve UM objeto, ou null;
   *   - lá aponta pra cá (parada_fotos.parada_id)   -> devolve uma LISTA.
   */
  function juntar(tabela, linha, cols) {
    const { juncoes } = separarSelect(cols);
    if (!juncoes.length) return { ...linha };

    const saida = { ...linha };
    for (const j of juncoes) {
      const chaveDaqui = singular(j.nome) + '_id';

      if (linha[chaveDaqui] !== undefined) {
        const alvo = linhasDe(j.nome).find(l => igual(l.id, linha[chaveDaqui]));
        saida[j.nome] = alvo ? juntar(j.nome, alvo, j.dentro) : null;
      } else {
        const chaveDeLa = singular(tabela) + '_id';
        saida[j.nome] = linhasDe(j.nome)
          .filter(l => igual(l[chaveDeLa], linha.id))
          .map(l => juntar(j.nome, l, j.dentro));
      }
    }
    return saida;
  }

  function consulta(nome) {
    const filtros = [];
    let patch = null;
    let modo = 'select';
    let contando = false;
    let limite = null;
    let colunas = '*';

    const casa = l => filtros.every(f => f(l));
    const selecionadas = () => {
      const r = linhasDe(nome).filter(casa);
      return limite == null ? r : r.slice(0, limite);
    };

    /** Executa o que foi montado e devolve { data, error, count }. */
    function rodar() {
      banco.chamadas.push({ tabela: nome, modo, filtros: filtros.length });

      if (modo === 'select') {
        const achadas = selecionadas();
        return {
          data: contando ? null : achadas.map(l => juntar(nome, l, colunas)),
          error: null,
          count: achadas.length
        };
      }
      if (modo === 'update') {
        const atingidas = selecionadas();
        for (const l of atingidas) Object.assign(l, patch);
        return { data: atingidas.map(l => juntar(nome, l, colunas)), error: null };
      }
      if (modo === 'delete') {
        const sobrevivem = linhasDe(nome).filter(l => !casa(l));
        const apagadas = linhasDe(nome).length - sobrevivem.length;
        banco.tabelas[nome] = sobrevivem;
        return { data: [], error: null, count: apagadas };
      }
      return { data: null, error: { message: 'modo desconhecido: ' + modo } };
    }

    const api = {
      select(cols, opcoes) {
        if (modo === 'select' || modo === 'update') colunas = cols || '*';
        if (modo === 'select') contando = !!(opcoes && opcoes.count);
        return api;
      },
      eq(campo, valor) { filtros.push(l => igual(valorDoCampo(l, campo), valor)); return api; },
      neq(campo, valor) { filtros.push(l => !igual(valorDoCampo(l, campo), valor)); return api; },
      in(campo, lista) { filtros.push(l => lista.some(v => igual(valorDoCampo(l, campo), v))); return api; },
      gte(campo, valor) { filtros.push(l => String(valorDoCampo(l, campo)) >= String(valor)); return api; },
      lte(campo, valor) { filtros.push(l => String(valorDoCampo(l, campo)) <= String(valor)); return api; },
      order() { return api; },
      limit(n) { limite = n; return api; },

      insert(entrada) {
        const novas = (Array.isArray(entrada) ? entrada : [entrada]).map(r => ({ ...r }));
        for (const r of novas) {
          if (r.id === undefined) r.id = nome + '-' + (linhasDe(nome).length + 1);
          linhasDe(nome).push(r);
        }
        banco.chamadas.push({ tabela: nome, modo: 'insert', linhas: novas.length });
        return prontoCom(novas);
      },

      upsert(entrada, opcoes) {
        const chave = (opcoes && opcoes.onConflict) || 'id';
        const novas = (Array.isArray(entrada) ? entrada : [entrada]).map(r => ({ ...r }));
        const saida = [];
        for (const r of novas) {
          const i = linhasDe(nome).findIndex(l => r[chave] !== undefined && igual(l[chave], r[chave]));
          if (i >= 0) { Object.assign(linhasDe(nome)[i], r); saida.push(linhasDe(nome)[i]); }
          else {
            if (r.id === undefined) r.id = nome + '-' + (linhasDe(nome).length + 1);
            linhasDe(nome).push(r); saida.push(r);
          }
        }
        banco.chamadas.push({ tabela: nome, modo: 'upsert', linhas: novas.length });
        return prontoCom(saida);
      },

      update(p) { modo = 'update'; patch = p; return api; },
      delete() { modo = 'delete'; return api; },

      single() {
        const r = rodar();
        if (r.error) return Promise.resolve(r);
        const uma = (r.data || [])[0];
        return Promise.resolve(uma
          ? { data: uma, error: null }
          : { data: null, error: { message: 'nenhuma linha encontrada' } });
      },
      maybeSingle() {
        const r = rodar();
        return Promise.resolve({ data: r.error ? null : ((r.data || [])[0] || null), error: r.error });
      },
      then(aoResolver, aoFalhar) { return Promise.resolve(rodar()).then(aoResolver, aoFalhar); }
    };

    /** insert/upsert já executaram; o .select()/.single() depois só formata. */
    function prontoCom(linhas) {
      const feito = {
        select() { return feito; },
        single() {
          return Promise.resolve(linhas[0]
            ? { data: { ...linhas[0] }, error: null }
            : { data: null, error: { message: 'nenhuma linha' } });
        },
        maybeSingle() { return Promise.resolve({ data: linhas[0] ? { ...linhas[0] } : null, error: null }); },
        then(aoResolver, aoFalhar) {
          return Promise.resolve({ data: linhas.map(l => ({ ...l })), error: null }).then(aoResolver, aoFalhar);
        }
      };
      return feito;
    }

    return api;
  }

  const cliente = {
    from: consulta,

    auth: {
      getUser: token => {
        const u = banco.usuarios[token];
        return Promise.resolve(u
          ? { data: { user: u }, error: null }
          : { data: null, error: { message: 'invalid token' } });
      }
    },

    storage: {
      from: balde => ({
        upload: async (caminho, corpo, opcoes) => {
          banco.arquivos.push({
            balde,
            caminho,
            tamanho: corpo && corpo.length ? corpo.length : 0,
            tipo: (opcoes && opcoes.contentType) || ''
          });
          return { data: { path: caminho }, error: null };
        },
        getPublicUrl: caminho => ({
          data: { publicUrl: `https://exemplo.supabase.co/storage/v1/object/public/${balde}/${caminho}` }
        })
      })
    }
  };

  /** Devolve tudo ao zero, entre um teste e outro. */
  function zerar() {
    banco.tabelas = {};
    banco.usuarios = {};
    banco.arquivos = [];
    banco.chamadas = [];
  }

  return { cliente, banco, zerar };
}

/**
 * Troca o cliente de verdade pelo de mentira, antes que qualquer função o peça.
 * Precisa rodar ANTES do require das funções — o módulo guarda a referência.
 */
export function instalar(Module, cliente) {
  const requireOriginal = Module.prototype.require;
  Module.prototype.require = function (caminho) {
    if (caminho === './supabase' || caminho === './lib/supabase') return { admin: () => cliente };
    return requireOriginal.apply(this, arguments);
  };
}

/** Um "event" no formato que as funções esperam (herdado do Netlify). */
export function evento(extra = {}) {
  return { httpMethod: 'POST', headers: {}, queryStringParameters: {}, body: null, ...extra };
}

/** Chama uma função e devolve { status, corpo } já com o JSON lido. */
export async function chamar(fn, extra = {}) {
  const r = await fn.handler(evento(extra));
  let corpo = null;
  try { corpo = JSON.parse(r.body); } catch (e) { corpo = r.body; }
  return { status: r.statusCode, corpo };
}
