/**
 * TESTE DOS HANDLERS DO HTML.
 *
 * Nenhuma dessas páginas é módulo: uma função só é alcançável pelo onclick do HTML
 * se alguém tiver feito "window.nome = nome" no fim do arquivo. Esquecer essa linha
 * não quebra nada na hora de salvar nem aparece em teste de sintaxe — só quebra no
 * celular do freteiro, no meio da rua, quando ele toca no botão e nada acontece.
 *
 * Este arquivo lê o HTML, junta todo onclick/onchange que chama função, e confere
 * que cada uma foi exportada e existe de verdade.
 *
 * Rodar:  node testes/handlers.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGINAS = ['public/entrega.html', 'public/painel.html', 'public/separacao.html', 'public/index.html'];

// Coisas do próprio navegador: o HTML pode chamar sem ninguém exportar.
const DO_NAVEGADOR = new Set(['window', 'document', 'alert', 'confirm', 'print', 'history', 'location', 'Number', 'String']);

let ok = 0, falhas = 0;
const achados = [];
const checa = (nome, cond, extra) => {
  if (cond) { ok++; console.log(`  OK    ${nome}${extra ? ' — ' + extra : ''}`); }
  else { falhas++; achados.push(nome); console.log(`  FALHA ${nome}${extra ? ' — ' + extra : ''}`); }
};

console.log('\n============================================================');
console.log('  TODO onclick DO HTML TEM FUNÇÃO EXPORTADA?');
console.log('============================================================');

for (const pagina of PAGINAS) {
  const arquivo = path.join(raiz, pagina);
  if (!fs.existsSync(arquivo)) { console.log(`  (pulando ${pagina}, não existe)`); continue; }
  const s = fs.readFileSync(arquivo, 'utf8');

  // O (?<![.\w$]) é o que separa "marcar(" de "document.getElementById(": só
  // interessa função chamada sozinha, porque método de objeto ninguém exporta.
  const chamados = new Set(
    [...s.matchAll(/on(?:click|change|input|submit)\s*=\s*["']([^"']*)["']/g)]
      .flatMap(m => [...m[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(x => x[1]))
      .filter(n => !DO_NAVEGADOR.has(n))
  );
  const exportados = new Set([...s.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1]));
  const declarados = new Set([
    ...[...s.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1]),
    ...[...s.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)].map(m => m[1])
  ]);

  const semExportar = [...chamados].filter(f => !exportados.has(f));
  checa(`${pagina}: os ${chamados.size} handlers estão exportados`,
    semExportar.length === 0,
    semExportar.length ? 'faltam: ' + semExportar.join(', ') : '');

  const exportaFantasma = [...exportados].filter(f => !declarados.has(f));
  checa(`${pagina}: não exporta função que não existe`,
    exportaFantasma.length === 0,
    exportaFantasma.length ? 'fantasmas: ' + exportaFantasma.join(', ') : '');
}

console.log('\n============================================================');
console.log(`${ok} verificações passaram · ${falhas} falharam`);
if (falhas) { achados.forEach(a => console.log('  - ' + a)); process.exit(1); }
