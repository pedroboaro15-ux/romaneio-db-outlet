// GET  /api/push-diagnostico          — por que a notificação não chega
// POST /api/push-diagnostico { pessoaId } — manda uma de teste e conta o que houve
//
// Notificação é a coisa mais difícil de depurar deste app, porque ela falha em
// TRÊS lugares diferentes e os três são silenciosos:
//
//   1. As chaves VAPID não estão configuradas no servidor. lib/push.js faz
//      "return" e pronto — sem erro, sem log, sem nada.
//   2. A chave pública do servidor é diferente da que está escrita nas páginas
//      (entrega.html e separacao.html têm a chave FIXA no código). O celular se
//      inscreve com uma chave e o servidor assina com outra; o serviço de push
//      do Google/Apple rejeita, e a rejeição morre dentro de um catch.
//   3. Ninguém apertou "ativar notificações" no celular. Não há inscrição
//      nenhuma pra notificar.
//
// Do lado de fora os três são idênticos: "não chega nada". Esta tela diz qual é.
const { requireAdmin } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const { admin } = require('./lib/supabase');

// A MESMA chave que está escrita em public/entrega.html e public/separacao.html.
// Duplicar aqui é de propósito: é exatamente essa duplicação que o diagnóstico
// precisa conferir. Se um dia as páginas mudarem e isto não, o teste acusa.
const CHAVE_DAS_PAGINAS = 'BFC7weeC6mlzDogw_rk6P-ot8EbraPh_HfMsgIsylmFZ1nY767H_Q7hJkQPFTpYZHQTivPv4sVY6d3Ig6t8rchM';

const TABELAS = { freteiro: 'freteiros', estoquista: 'estoquistas', vendedor: 'vendedores' };

exports.handler = async event => {
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const sb = admin();
  const publica = process.env.VAPID_PUBLIC_KEY || '';
  const privada = process.env.VAPID_PRIVATE_KEY || '';

  /* ---------------- enviar um teste de verdade ---------------- */
  if (event.httpMethod === 'POST') {
    const { ok: corpoOk, corpo: b } = lerCorpo(event);
    if (!corpoOk) return json(400, { erro: 'JSON inválido' });
    if (!b.pessoaId) return json(400, { erro: 'escolha pra quem mandar o teste' });

    if (!publica || !privada) {
      return json(400, { erro: 'as chaves VAPID não estão configuradas no servidor — nenhuma notificação sai enquanto isso' });
    }

    const { data: subs } = await sb.from('push_subscriptions').select('*').eq('pessoa_id', b.pessoaId);
    if (!subs || !subs.length) {
      return json(400, { erro: 'essa pessoa não ativou notificações em nenhum aparelho' });
    }

    // Aqui o erro NÃO é engolido, ao contrário do envio normal. No envio normal
    // engolir é certo (notificação não pode derrubar a criação de uma rota);
    // aqui o erro É a resposta.
    let wp;
    try {
      wp = require('web-push');
    } catch (e) {
      return json(500, { erro: 'a biblioteca web-push não carregou no servidor: ' + e.message });
    }
    wp.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contato@exemplo.com', publica, privada);

    const resultados = [];
    for (const s of subs) {
      try {
        await wp.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ titulo: 'Teste do Romaneio', corpo: 'Se você está lendo isto, as notificações funcionam.', url: '/' })
        );
        resultados.push({ aparelho: String(s.endpoint || '').slice(0, 40) + '…', ok: true });
      } catch (e) {
        resultados.push({
          aparelho: String(s.endpoint || '').slice(0, 40) + '…',
          ok: false,
          status: e && e.statusCode,
          erro: (e && (e.body || e.message) || 'erro desconhecido').toString().slice(0, 300)
        });
      }
    }

    const enviadas = resultados.filter(r => r.ok).length;
    return json(200, { enviadas, total: resultados.length, resultados });
  }

  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });

  /* ---------------- o retrato da situação ---------------- */
  const { data: subs } = await sb.from('push_subscriptions').select('pessoa_id, endpoint');
  const porPessoa = new Map();
  for (const s of (subs || [])) {
    porPessoa.set(s.pessoa_id, (porPessoa.get(s.pessoa_id) || 0) + 1);
  }

  // Nome de quem tem inscrição, e também de quem NÃO tem: a lista de quem falta
  // ativar é metade da resposta.
  const pessoas = [];
  for (const [tipo, tabela] of Object.entries(TABELAS)) {
    const { data } = await sb.from(tabela).select('id, nome');
    for (const p of (data || [])) {
      pessoas.push({ nome: p.nome, tipo, pessoaId: p.id, aparelhos: porPessoa.get(p.id) || 0 });
    }
  }
  pessoas.sort((a, b) => a.aparelhos - b.aparelhos || a.nome.localeCompare(b.nome, 'pt-BR'));

  const problemas = [];
  if (!publica || !privada) {
    problemas.push('As chaves VAPID não estão configuradas no servidor. Enquanto isso, NENHUMA notificação sai — e o código nem tenta, sai calado.');
  } else if (publica !== CHAVE_DAS_PAGINAS) {
    problemas.push('A chave pública do servidor é DIFERENTE da que está nas páginas. Os celulares se inscrevem com uma e o servidor assina com outra, então o serviço de push rejeita tudo. É a falha mais difícil de perceber, porque parece que está tudo certo.');
  }
  if (!pessoas.some(p => p.aparelhos > 0)) {
    problemas.push('Ninguém ativou notificações em aparelho nenhum. Cada pessoa precisa abrir a página dela no celular e tocar no sininho — e o navegador só pergunta uma vez, então quem negou precisa liberar nos ajustes do site.');
  }

  return json(200, {
    configurado: !!(publica && privada),
    chaveConfere: !!publica && publica === CHAVE_DAS_PAGINAS,
    // Só o começo: a pública não é segredo, mas não há motivo pra jogar inteira na tela.
    chaveDoServidor: publica ? publica.slice(0, 12) + '…' : '(vazia)',
    chaveDasPaginas: CHAVE_DAS_PAGINAS.slice(0, 12) + '…',
    totalAparelhos: (subs || []).length,
    pessoas,
    problemas
  });
};
