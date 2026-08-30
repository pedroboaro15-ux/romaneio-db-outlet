// Datas sempre no fuso da Paraíba (UTC-3, sem horário de verão).
// O servidor do Netlify roda em UTC — sem isso, tudo depois das 21h vira "amanhã".
const FUSO = 'America/Fortaleza';

// Devolve 'AAAA-MM-DD' de hoje no fuso da loja.
function hojeBR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date());
}

// Devolve 'AAAA-MM-DD' daqui a N dias, no fuso da loja.
function emDiasBR(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(d);
}

module.exports = { hojeBR, emDiasBR, FUSO };
