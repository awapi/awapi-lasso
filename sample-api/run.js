const path = require('path');
const esbuild = require('esbuild');

process.env.AWAPI_SAMPLE_API_CLI = '1';

const entryPoint = path.resolve(__dirname, 'server.ts');
const out = esbuild.buildSync({
  entryPoints: [entryPoint],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['graphql'],
  write: false,
});

const fn = new Function(
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
  out.outputFiles[0].text,
);
fn(require, module, exports, __dirname, entryPoint);
