import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import { readFileSync } from 'node:fs';

// Tiny custom plugin: after Vite builds, write a service worker (sw.js) that
// knows the exact list of hashed files to pre-cache. That way the very first
// visit downloads everything needed to work offline afterwards.
function serviceWorkerPlugin() {
  return {
    name: 'escanmo-sw',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const precache = ['./', './index.html', './manifest.json', './vendor/opencv.js',
        './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
        ...files.filter((f) => f !== 'index.html').map((f) => './' + f)];
      const template = readFileSync('src/sw-template.js', 'utf8');
      const source = template
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2))
        .replace('__VERSION__', Date.now().toString(36));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  base: './',
  // mkcert creates a locally-trusted HTTPS certificate. iPhone Safari only
  // allows camera access on HTTPS (or localhost), so this is required to test
  // on a real phone over Wi-Fi.
  plugins: [mkcert(), serviceWorkerPlugin()],
  server: { host: true, https: true },
  preview: { host: true, https: true },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
