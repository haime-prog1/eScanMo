// Copies big third-party files that must be served as plain static files
// (not bundled) into public/vendor. OpenCV.js is ~13 MB of WebAssembly glue;
// we load it inside a Web Worker with importScripts(), so it needs a real URL.
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ['node_modules/@techstark/opencv-js/dist/opencv.js', 'public/vendor/opencv.js'],
];
for (const [from, to] of files) {
  const src = resolve(root, from);
  if (!existsSync(src)) { console.warn('[copy-vendor] missing', from); continue; }
  mkdirSync(dirname(resolve(root, to)), { recursive: true });
  copyFileSync(src, resolve(root, to));
  console.log('[copy-vendor]', from, '->', to);
}
