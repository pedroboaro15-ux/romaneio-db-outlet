// Freio de tentativas de login.
//
// O login da equipe é só telefone — não tem senha nem PIN. Isso foi escolha
// consciente (gente na rua, mão suja, pressa), mas deixa uma porta: quem tentar
// número atrás de número acaba acertando um telefone cadastrado. O freio não
// impede o acerto; ele torna a força bruta lenta o bastante pra não valer a pena.
//
// Duas chaves ao mesmo tempo, e a mais apertada vence:
//   tel:<telefone>  — alguém insistindo num número específico
//   ip:<endereço>   — alguém varrendo vários números da mesma máquina
//
// Só tentativa ERRADA conta. Quem acerta tem a contagem zerada na hora, então
// o freteiro que digita torto duas vezes nunca sente isso.
const { admin } = require('./supabase');

const JANELA_MIN = 15;
const MAX_POR_TELEFONE = 6;
const MAX_POR_IP = 20;

const agora = () => Date.now();
const limiteDe = chave => (chave.startsWith('ip:') ? MAX_POR_IP : MAX_POR_TELEFONE);

/** o IP de quem chamou, do jeito que o Cloudflare entrega */
function ipDe(event) {
  const h = event.headers || {};
  return h['cf-connecting-ip'] || h['x-nf-client-connection-ip'] ||
         String(h['x-forwarded-for'] || '').split(',')[0].trim() || 'desconhecido';
}

/**
 * Já passou do limite? Devolve os segundos que faltam pra liberar, ou 0.
 * Se a tabela não existir ainda, devolve 0: o freio não pode ser o motivo
 * de ninguém conseguir entrar.
 */
async function bloqueado(chaves) {
  const sb = admin();
  const { data, error } = await sb
    .from('tentativas_login').select('chave, tentativas, janela_em').in('chave', chaves);
  if (error || !data) return 0;

  let espera = 0;
  for (const linha of data) {
    const fimJanela = new Date(linha.janela_em).getTime() + JANELA_MIN * 60 * 1000;
    if (fimJanela <= agora()) continue;                      // janela velha, não conta
    if (linha.tentativas < limiteDe(linha.chave)) continue;
    espera = Math.max(espera, Math.ceil((fimJanela - agora()) / 1000));
  }
  return espera;
}

/** Registra uma tentativa errada em cada chave. */
async function errou(chaves) {
  const sb = admin();
  for (const chave of chaves) {
    const { data } = await sb
      .from('tentativas_login').select('tentativas, janela_em').eq('chave', chave).maybeSingle();

    const janelaViva = data && (new Date(data.janela_em).getTime() + JANELA_MIN * 60 * 1000) > agora();
    await sb.from('tentativas_login').upsert({
      chave,
      tentativas: janelaViva ? data.tentativas + 1 : 1,
      janela_em: janelaViva ? data.janela_em : new Date().toISOString()
    });
  }
}

/** Acertou: a contagem some, pra próxima tentativa começar limpa. */
async function acertou(chaves) {
  await admin().from('tentativas_login').delete().in('chave', chaves);
}

module.exports = { ipDe, bloqueado, errou, acertou, JANELA_MIN, MAX_POR_TELEFONE, MAX_POR_IP };
