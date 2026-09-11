// POST /.netlify/functions/omie-raw  { path, call, param }
// Diagnóstico: chama qualquer método da Omie e devolve a resposta crua.
// Útil quando um campo vier vazio/errado — ver o JSON real que a Omie devolve.
const { requireAdmin } = require('./lib/auth');
const { json, lerCorpo } = require('./lib/http');
const omie = require('./lib/omie');

// O "path" vem do corpo e é colado no endereço da Omie com new URL(path, BASE).
// O detalhe que morde: quando o path é ABSOLUTO ("https://...", ou até "//host"),
// o new URL joga o BASE fora e vai pro endereço novo. Como toda chamada leva
// app_key e app_secret no corpo, apontar o path pra fora é mandar as suas
// credenciais da Omie de presente pra quem escreveu o endereço.
//
// É rota de gerente, então não é qualquer um da rua — mas basta você abrir um
// link preparado com a sua sessão aberta. Segredo não se protege só por senha.
//
// Aqui só passa caminho relativo simples: letra, número, barra, hífen, ponto e
// sublinhado. Sem "//" no começo, sem ":" (que abriria "javascript:" e afins),
// e sem ".." (que subiria pra fora de /api/v1/).
const CAMINHO_OMIE = /^[A-Za-z0-9][A-Za-z0-9._\-]*(\/[A-Za-z0-9._\-]+)*\/?$/;

function caminhoSeguro(path) {
  const p = String(path || '').trim();
  if (!p || p.includes('..') || p.includes(':') || p.startsWith('/')) return null;
  return CAMINHO_OMIE.test(p) ? p : null;
}

exports.handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { erro: 'método não permitido' });
  const user = await requireAdmin(event);
  if (!user) return json(401, { erro: 'não autenticado' });

  const { ok: corpoOk, corpo: b } = lerCorpo(event);
  if (!corpoOk) return json(400, { erro: 'JSON inválido' });
  if (!b.path || !b.call) return json(400, { erro: 'informe path e call' });

  const path = caminhoSeguro(b.path);
  if (!path) {
    return json(400, { erro: 'path inválido — use o caminho relativo da Omie, ex.: geral/pedidos/' });
  }

  try {
    const r = await omie.post(path, b.call, b.param || {}, omie.creds());
    return json(200, r);
  } catch (e) {
    return json(502, { erro: e.message });
  }
};
