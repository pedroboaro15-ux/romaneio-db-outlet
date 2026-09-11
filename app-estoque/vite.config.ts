import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// O .env vive na raiz do repositorio, uma pasta acima: um arquivo so para o
// app do estoque e para o Worker do romaneio, em vez de dois pra manter iguais.
const RAIZ = path.resolve(process.cwd(), '..');

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, RAIZ, 'VITE_');

  // O Vite troca import.meta.env.VITE_* pelo valor literal na hora do build.
  // Sem as variáveis ele não reclama: gera um pacote com "undefined" dentro,
  // publica normalmente, e o site abre em branco.
  //
  // Então o build recusa. Melhor quebrar aqui, dizendo o que falta, do que
  // descobrir na tela do cliente.
  if (command === 'build') {
    const faltando = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']
      .filter((k) => !env[k]);

    if (faltando.length) {
      throw new Error(
        `\n\n  Faltam ${faltando.join(' e ')}.\n\n` +
        '  Na sua máquina: copie .env.example para .env e preencha.\n' +
        '  No Cloudflare:  Workers & Pages > seu Worker > Settings >\n' +
        '                  Build > Variables and Secrets, e refaça o build.\n' +
        '  Os valores estão em Supabase > Project Settings > API.\n'
      );
    }
  }

  return {
    // O app nao mora mais na raiz do site: a raiz agora e a porta de entrada
    // que pergunta quem voce e. O estoque vive em /estoque/, entao todo caminho
    // de arquivo que o Vite escreve no HTML precisa desse prefixo.
    base: '/estoque/',
    envDir: RAIZ,
    plugins: [react()],
    resolve: {
      // Preact tem a mesma API do React e pesa bem menos. O app não usa
      // Suspense nem recursos concorrentes, então a troca é transparente.
      alias: {
        react: 'preact/compat',
        'react-dom': 'preact/compat',
        'react/jsx-runtime': 'preact/jsx-runtime',
      },
    },
    build: {
      // O build cai dentro da pasta que o Worker publica como arquivo estatico.
      // Um Worker so pode declarar UMA pasta de assets (wrangler.toml), entao as
      // paginas do romaneio e o app do estoque saem da mesma public/.
      outDir: '../public/estoque',
      emptyOutDir: true,
      // separa o supabase do resto: a tela abre sem esperar o SDK inteiro
      rollupOptions: {
        output: {
          manualChunks: { supabase: ['@supabase/auth-js', '@supabase/postgrest-js'] },
        },
      },
    },
  };
});
