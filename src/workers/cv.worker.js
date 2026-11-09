// =============================================================================
// OpenCV worker — ALL heavy image work happens here, off the main (UI) thread.
// Why a worker? JavaScript on a web page runs on one thread. If we did a 12MP
// perspective warp there, scrolling and buttons would freeze for a second.
// A Web Worker is a separate thread: the UI stays smooth while this crunches.
//
// Messages in:  { id, type, payload }
// Messages out: { id, ok: true, result } or { id, ok: false, error, code }
// =============================================================================

let cv = null;
let cvReady = null;

// Load OpenCV.js once, lazily (it's ~13 MB, so we only pay for it when needed).
function loadCv(baseUrl) {
  if (!cvReady) {
    cvReady = (async () => {
      // OpenCV's file is a classic script; importScripts works in module workers
      // only on some browsers, so we fetch it and evaluate it ourselves.
      const res = await fetch(new URL('vendor/opencv.js', baseUrl));
      if (!res.ok) throw new Error('Could not load OpenCV (' + res.status + ')');
      const code = await res.text();
      (0, eval)(code); // indirect eval = runs in global scope, defines self.cv
      cv = await self.cv; // self.cv is a Promise that resolves once WASM is ready
      self.cv = cv;
      return cv;
    })();
  }
  return cvReady;
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try {
    await loadCv(payload.baseUrl);
    let result, transfer = [];
    if (type === 'init') result = true;
    else if (type === 'detect') result = detectFromImageData(payload.imageData);
    else if (type === 'detectBlob') result = await detectFromBlob(payload.blob);
    else if (type === 'process') result = await processPage(payload);
    else throw new Error('Unknown task ' + type);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    const msg = String(err?.message || err);
    // WASM running out of memory shows up as "abort", "OOM" or a RangeError.
    const code = /memory|abort|oom|allocation|RangeError/i.test(msg + (err?.name || '')) ? 'memory' : 'error';
    self.postMessage({ id, ok: false, error: msg, code });
  }
};

// ---------------------------------------------------------------------------
// Small helper: OpenCV.js Mats live in WASM memory and are NOT garbage
// collected. Every Mat we create must be .delete()d or memory leaks fast.
// `track()` remembers Mats so `cleanup()` can delete them all at once.
function scope() {
  const list = [];
  return {
    track: (m) => (list.push(m), m),
    cleanup: () => { for (const m of list) { try { m.delete(); } catch { /* already gone */ } } },
  };
}

// Decode an image Blob into an OpenCV Mat (RGBA), shrinking it so the longest
// side is at most `maxDim` pixels (protects against running out of memory).
async function blobToMat(blob, maxDim, s) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const origW = bmp.width, origH = bmp.height;
  bmp.close();
  const mat = s.track(cv.matFromImageData(ctx.getImageData(0, 0, w, h)));
  return { mat, scale, origW, origH };
}

// ---------------------------------------------------------------------------
// EDGE DETECTION: find the biggest 4-sided shape (the paper) in the image.
// Steps: grayscale -> blur (remove noise) -> Canny (find edges) -> dilate
// (close small gaps in edges) -> find outlines -> simplify each outline to a
// polygon -> keep the largest convex one with exactly 4 corners.
function findQuad(rgba) {
  const s = scope();
  try {
    const W = rgba.cols, H = rgba.rows;
    const gray = s.track(new cv.Mat());
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    // A morphological "close" wipes out the text inside the page, so the page
    // outline is the strongest edge left.
    const k = s.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)));
    cv.morphologyEx(gray, gray, cv.MORPH_CLOSE, k);
    const edges = s.track(new cv.Mat());
    cv.Canny(gray, edges, 40, 120);
    const k3 = s.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    cv.dilate(edges, edges, k3);

    const contours = s.track(new cv.MatVector());
    const hier = s.track(new cv.Mat());
    cv.findContours(edges, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let best = null, bestArea = W * H * 0.12; // ignore anything under 12% of frame
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area > bestArea) {
        const approx = new cv.Mat();
        cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true);
        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const d = approx.data32S;
          best = [[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]];
          bestArea = area;
        }
        approx.delete();
      }
      c.delete();
    }
    if (!best) return null;
    // Pull corners ~1% toward the center: the detected outline sits right ON
    // the paper edge, and including it leaves thin dark lines on the scan.
    const cx = best.reduce((a, p) => a + p[0], 0) / 4, cy = best.reduce((a, p) => a + p[1], 0) / 4;
    return orderCorners(best.map(([x, y]) => [x + (cx - x) * 0.01, y + (cy - y) * 0.01]));
  } finally { s.cleanup(); }
}

// Put corners in a fixed order: top-left, top-right, bottom-right, bottom-left.
// Trick: top-left has the smallest x+y, bottom-right the largest; top-right has
// the smallest y-x, bottom-left the largest.
function orderCorners(pts) {
  const sum = pts.map((p) => p[0] + p[1]);
  const diff = pts.map((p) => p[1] - p[0]);
  const at = (arr, fn) => pts[arr.indexOf(fn(...arr))];
  return [at(sum, Math.min), at(diff, Math.min), at(sum, Math.max), at(diff, Math.max)];
}

function detectFromImageData(imageData) {
  const s = scope();
  try {
    const mat = s.track(cv.matFromImageData(imageData));
    const q = findQuad(mat);
    // Return corners as fractions (0..1) so the caller can map to any size.
    return q ? q.map(([x, y]) => [x / mat.cols, y / mat.rows]) : null;
  } finally { s.cleanup(); }
}

async function detectFromBlob(blob) {
  const s = scope();
  try {
    const { mat, scale, origW, origH } = await blobToMat(blob, 640, s);
    const q = findQuad(mat);
    return { width: origW, height: origH, quad: q ? q.map(([x, y]) => [x / scale, y / scale]) : null };
  } finally { s.cleanup(); }
}

// ---------------------------------------------------------------------------
// PERSPECTIVE CORRECTION: "un-tilt" the page so it becomes a flat rectangle.
function warp(src, quad, s) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const [tl, tr, br, bl] = quad;
  const w = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  const h = Math.round(Math.max(dist(tl, bl), dist(tr, br)));
  const from = s.track(cv.matFromArray(4, 1, cv.CV_32FC2, quad.flat()));
  const to = s.track(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, w, 0, w, h, 0, h]));
  const M = s.track(cv.getPerspectiveTransform(from, to));
  const out = s.track(new cv.Mat());
  cv.warpPerspective(src, out, M, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
  return out;
}

// "Flatten the lighting": divide each pixel by a heavily blurred copy of the
// image (an estimate of the paper's background brightness). Shadows and uneven
// light disappear and the paper becomes evenly white.
function normalizeLighting(rgb, s) {
  const small = s.track(new cv.Mat());
  const f = 0.125;
  cv.resize(rgb, small, new cv.Size(0, 0), f, f, cv.INTER_AREA);
  const kk = s.track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7)));
  cv.dilate(small, small, kk); // dilate = keep the bright paper, drop dark text
  cv.medianBlur(small, small, 7);
  const bg = s.track(new cv.Mat());
  cv.resize(small, bg, new cv.Size(rgb.cols, rgb.rows), 0, 0, cv.INTER_LINEAR);
  const out = s.track(new cv.Mat());
  cv.divide(rgb, bg, out, 255);
  return out;
}

function applyFilter(rgba, opts, s) {
  const { filter = 'original', brightness = 0, contrast = 0 } = opts;
  let rgb = s.track(new cv.Mat());
  cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);

  if (filter === 'auto') {
    // Stretch each color channel so the darkest pixel becomes black and the
    // brightest white, then sharpen a little ("unsharp mask").
    const ch = s.track(new cv.MatVector());
    cv.split(rgb, ch);
    for (let i = 0; i < 3; i++) { const c = ch.get(i); cv.normalize(c, c, 0, 255, cv.NORM_MINMAX); ch.set(i, c); c.delete(); }
    cv.merge(ch, rgb);
    const blur = s.track(new cv.Mat());
    cv.GaussianBlur(rgb, blur, new cv.Size(0, 0), 2);
    cv.addWeighted(rgb, 1.5, blur, -0.5, 0, rgb);
  } else if (filter === 'magic') {
    // Even out lighting, then boost color saturation so stamps/ink pop.
    rgb = normalizeLighting(rgb, s);
    const hsv = s.track(new cv.Mat());
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    const ch = s.track(new cv.MatVector());
    cv.split(hsv, ch);
    const sat = ch.get(1); sat.convertTo(sat, -1, 1.35, 0); ch.set(1, sat); sat.delete();
    cv.merge(ch, hsv);
    cv.cvtColor(hsv, rgb, cv.COLOR_HSV2RGB);
    rgb.convertTo(rgb, -1, 1.15, -20); // a bit more contrast
  } else if (filter === 'gray') {
    const g = s.track(new cv.Mat());
    cv.cvtColor(rgb, g, cv.COLOR_RGB2GRAY);
    cv.cvtColor(g, rgb, cv.COLOR_GRAY2RGB);
  } else if (filter === 'bw') {
    // Black & white: flatten lighting first, then "adaptive threshold" decides
    // black-or-white per neighborhood, so shadows don't turn into black blobs.
    const flat = normalizeLighting(rgb, s);
    const g = s.track(new cv.Mat());
    cv.cvtColor(flat, g, cv.COLOR_RGB2GRAY);
    let block = Math.round(Math.max(rgb.cols, rgb.rows) / 50) | 1; // must be odd
    block = Math.max(15, block);
    cv.adaptiveThreshold(g, g, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, block, 10);
    cv.cvtColor(g, rgb, cv.COLOR_GRAY2RGB);
  } else if (filter === 'lighten') {
    rgb.convertTo(rgb, -1, 1.05, 40);
  }

  // Brightness/contrast sliders (-100..100). Contrast pivots around mid-gray
  // (128) so increasing it doesn't also make the whole image brighter.
  if (brightness || contrast) {
    const alpha = 1 + contrast / 100;
    const beta = brightness * 1.27 + 128 * (1 - alpha);
    rgb.convertTo(rgb, -1, alpha, beta);
  }
  const out = s.track(new cv.Mat());
  cv.cvtColor(rgb, out, cv.COLOR_RGB2RGBA);
  return out;
}

function rotate(mat, deg, s) {
  const codes = { 90: cv.ROTATE_90_CLOCKWISE, 180: cv.ROTATE_180, 270: cv.ROTATE_90_COUNTERCLOCKWISE };
  if (!codes[deg]) return mat;
  const out = s.track(new cv.Mat());
  cv.rotate(mat, out, codes[deg]);
  return out;
}

async function matToBlob(mat, quality, maxSide) {
  const img = new ImageData(new Uint8ClampedArray(mat.data), mat.cols, mat.rows);
  const canvas = new OffscreenCanvas(mat.cols, mat.rows);
  canvas.getContext('2d').putImageData(img, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  let thumb = null;
  if (maxSide) {
    const sc = Math.min(1, maxSide / Math.max(mat.cols, mat.rows));
    const t = new OffscreenCanvas(Math.round(mat.cols * sc), Math.round(mat.rows * sc));
    t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height);
    thumb = await t.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  }
  return { blob, thumb, width: mat.cols, height: mat.rows };
}

// Full pipeline for one page: decode -> crop/warp -> filter -> rotate -> JPEG.
async function processPage({ blob, quad, filter, brightness, contrast, rotation = 0, maxDim = 3000, quality = 0.9, thumbSize = 0 }) {
  const s = scope();
  try {
    // Decode a little bigger than the target so the warp has detail to use.
    const { mat, scale } = await blobToMat(blob, maxDim * 1.25, s);
    let m = mat;
    if (quad) m = warp(mat, quad.map(([x, y]) => [x * scale, y * scale]), s);
    // Final size cap after warping.
    const k = Math.min(1, maxDim / Math.max(m.cols, m.rows));
    if (k < 1) { const r = s.track(new cv.Mat()); cv.resize(m, r, new cv.Size(0, 0), k, k, cv.INTER_AREA); m = r; }
    m = applyFilter(m, { filter, brightness, contrast }, s);
    m = rotate(m, rotation, s);
    return await matToBlob(m, quality, thumbSize);
  } finally { s.cleanup(); }
}
