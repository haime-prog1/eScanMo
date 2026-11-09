// Main-thread side of the OpenCV worker. Turns "post a message and wait for a
// reply" into simple async functions: `await processPage({...})`.
let worker = null;
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject }
const baseUrl = new URL('./', document.baseURI).href;

function getWorker() {
  if (worker) return worker;
  // Vite sees `new URL(..., import.meta.url)` and bundles the worker file.
  worker = new Worker(new URL('../workers/cv.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { id, ok, result, error, code } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (ok) p.resolve(result);
    else { const err = new Error(error); err.code = code; p.reject(err); if (code === 'memory') restart(); }
  };
  // If the worker crashes outright (e.g. the phone killed it for memory),
  // fail every waiting call and start a fresh worker next time.
  worker.onerror = (e) => {
    const err = new Error(e.message || 'Image worker crashed'); err.code = 'memory';
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    restart();
  };
  return worker;
}

function restart() { try { worker?.terminate(); } catch { /* ignore */ } worker = null; }

function call(type, payload = {}, transfer = []) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, type, payload: { ...payload, baseUrl } }, transfer);
  });
}

/** Start loading OpenCV in the background (call early to hide the delay). */
export const warmUp = () => call('init').catch(() => {});
/** Find page corners in a small video frame. Returns 4 [x,y] fractions or null. */
export const detectFrame = (imageData) => call('detect', { imageData }, [imageData.data.buffer]);
/** Find page corners in a full photo. Returns { width, height, quad|null } in pixels. */
export const detectBlob = (blob) => call('detectBlob', { blob });
/** Crop + warp + filter + rotate a page. Returns { blob, thumb, width, height }. */
export const processPage = (opts) => call('process', opts);
