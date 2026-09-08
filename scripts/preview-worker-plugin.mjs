import esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let bundle;
async function runtime() {
  bundle ??= Promise.all([
    esbuild.build({ entryPoints: [fileURLToPath(new URL('../src/preview-worker/frame.ts', import.meta.url))], bundle: true, format: 'iife', globalName: '__RCB_PREVIEW__', minify: true, platform: 'browser', target: 'es2022', write: false }),
    readFile(require.resolve('@ampproject/worker-dom/dist/worker/worker.js'), 'utf8'),
    esbuild.build({ entryPoints: [fileURLToPath(new URL('../src/preview-worker/canvas.ts', import.meta.url))], bundle: true, format: 'iife', minify: true, platform: 'browser', target: 'es2022', write: false })
  ]).then(([main, worker, canvas]) => ({ main: main.outputFiles[0].text, worker: worker.replace(/^\/\/# sourceMappingURL=.*$/gm, ''), canvas: canvas.outputFiles[0].text }));
  return await bundle;
}
export function previewWorkerPlugin() {
  return { name: 'preview-worker', setup(build) {
    build.onResolve({filter: /^virtual:preview-worker-runtime$/}, () => ({path: 'runtime', namespace: 'preview-worker'}));
    build.onLoad({filter: /.*/, namespace: 'preview-worker'}, async () => ({contents: `export default ${JSON.stringify(await runtime())};`, loader: 'js'}));
  }};
}
export function previewWorkerVitePlugin() {
  return { name: 'preview-worker', resolveId: id => id === 'virtual:preview-worker-runtime' ? '\0preview-worker' : null,
    load: async id => id === '\0preview-worker' ? `export default ${JSON.stringify(await runtime())};` : null };
}
