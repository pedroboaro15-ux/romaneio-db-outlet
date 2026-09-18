// GET /api/quem-sou
//
// Diz ao painel quem está do outro lado: 'admin' ou 'vendedor'.
//
// Existe porque o papel NÃO pode ser decidido no navegador. O painel guarda o
// token no localStorage, e localStorage é editável por quem abre o aparelho —
// alguém poderia escrever papel: 'admin' ali e ganhar as abas escondidas. Ganhar
// a ABA não seria grave sozinho (cada endpoint confere de novo), mas uma tela
// cheia de erro vermelho é péssima de usar e péssima de diagnosticar.
//
// Então quem responde é o servidor, olhando o token de verdade.
//
// Só quem usa o painel entra aqui. Freteiro e estoquista têm sessão válida mas
// não são deste app: devolver 403 pra eles é mais honesto que devolver o papel e
// deixar a tela montar algo que não vai funcionar.
const { identificar } = require('./lib/auth');
const { json } = require('./lib/http');

exports.handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { erro: 'método não permitido' });

  const quem = await identificar(event);
  if (!quem) return json(401, { erro: 'não autenticado' });

  if (quem.role !== 'admin' && quem.role !== 'vendedor') {
    return json(403, { erro: 'este login não abre o painel' });
  }

  return json(200, { role: quem.role, nome: quem.nome || '' });
};
