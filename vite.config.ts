import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import electronSimple from 'vite-plugin-electron/simple';
import { startup } from 'vite-plugin-electron';
import { resolve } from 'path';
import {
  createSampleApiServer,
  type SampleApiServerInstance,
} from './sample-api/server';

function sampleApiDevPlugin(): Plugin {
  let instance: SampleApiServerInstance | null = null;
  return {
    name: 'awapi-lasso-sample-api-dev',
    apply: 'serve',
    configureServer(viteServer) {
      if (process.env.NO_SAMPLE_API === '1') return;
      const port = process.env.SAMPLE_API_PORT
        ? Number.parseInt(process.env.SAMPLE_API_PORT, 10)
        : 8080;
      instance = createSampleApiServer();
      instance
        .start(port, '127.0.0.1')
        .then(url => {
          console.log(
            `  ➜  Sample API (REST + GraphQL + OAuth2): ${url} (/v1/orders, /graphql, /oauth/token)`,
          );
        })
        .catch((err: NodeJS.ErrnoException) => {
          if (err?.code === 'EADDRINUSE') {
            console.warn(
              `  ⚠  Sample API skipped: port ${port} is already in use (set SAMPLE_API_PORT to override).`,
            );
          } else {
            console.warn('  ⚠  Failed to start Sample API:', err);
          }
          instance = null;
        });

      viteServer.httpServer?.once('close', () => {
        if (instance) {
          instance.stop().catch(() => {});
          instance = null;
        }
      });
    },
  };
}

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: [
      '**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../main/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../preload/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../shared/**/*.{test,spec}.?(c|m)[jt]s?(x)',
      '../../sample-api/**/*.{test,spec}.?(c|m)[jt]s?(x)',
    ],
  },
  plugins: [
    react(),
    ...(!process.env.VITEST
      ? [
          sampleApiDevPlugin(),
          electronSimple({
            main: {
              entry: resolve(__dirname, 'src/main/main.ts'),
              onstart() {
                startup(['.', '--no-sandbox'], { cwd: __dirname });
              },
              vite: {
                build: {
                  outDir: resolve(__dirname, 'dist/main'),
                  rolldownOptions: {
                    // node-pty is a native module; it must be loaded from node_modules at runtime.
                    external: ['electron', 'node-pty'],
                  },
                },
              },
            },
            preload: {
              input: resolve(__dirname, 'src/preload/index.ts'),
              vite: {
                build: {
                  outDir: resolve(__dirname, 'dist/preload'),
                  rollupOptions: {
                    external: ['electron'],
                  },
                },
              },
            },
            renderer: {},
          }),
        ]
      : []),
  ],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
});
