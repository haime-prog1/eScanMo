// The Scan screen: live camera, page-edge overlay, auto-capture, batch tray.
import { Camera, cameraErrorMessage } from './camera.js';
import { detectFrame, detectBlob, warmUp } from '../processing/cvClient.js';
import { session, newPage, fullQuad } from '../ui/session.js';
import { pickImages, importFiles } from './importer.js';
import { getSetting, setSetting } from '../storage/db.js';
import { h, toast, explainError } from '../ui/toast.js';
import { go } from '../ui/router.js';

const DETECT_SIZE = 360;       // detection runs on a small copy of the frame: fast
const STABLE_FRAMES = 6;       // corners must hold still this many checks...
const STABLE_TOLERANCE = 0.02; // ...within 2% of the frame size
const COOLDOWN_MS = 2200;      // pause after a capture so we don't double-shoot

export async function renderScan(root) {
  warmUp(); // start loading OpenCV while the camera spins up
  let autoCapture = await getSetting('autoCapture', true);

  const video = h('video', { autoplay: true, playsinline: true, muted: true });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('overlay');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
  svg.append(poly);
  const ring = h('div', { class: 'stable-ring' });
  const hint = h('div', { class: 'scan-hint' }, 'Starting camera…');
  const flash = h('div', { class: 'flash' });
  const count = h('span', { class: 'count' }, '0');
  const thumbImg = h('img', { alt: '' });
  const trayBtn = h('button', { class: 'tray', onclick: finish, 'aria-label': 'Review pages' }, thumbImg, count);
  const autoBtn = h('button', { class: 'pill', onclick: toggleAuto }, '');
  const torchBtn = h('button', { class: 'pill', hidden: true, onclick: toggleTorch }, '⚡ Off');
  const shutter = h('button', { class: 'shutter', 'aria-label': 'Take photo', onclick: () => capture(false) });

  const stage = h('div', { class: 'cam-stage' }, video, svg, ring, flash, hint);
  root.append(h('div', { class: 'scan' },
    h('div', { class: 'scan-top' },
      h('button', { class: 'pill', onclick: () => go(session.pages.length ? 'editor' : 'home') }, '✕'),
      autoBtn, torchBtn),
    stage,
    h('div', { class: 'scan-bottom' },
      h('button', { class: 'pill', onclick: doImport }, 'Import'),
      shutter,
      trayBtn)));

  const cam = new Camera(video);
  let running = true, busy = false, lastQuad = null, history = [], cooldownUntil = 0, torch = false, raf = 0;
  const small = document.createElement('canvas');
  const sctx = small.getContext('2d', { willReadFrequently: true });

  updateAuto(); updateTray();

  try {
    await cam.start();
    if (!running) { cam.stop(); return; }
    hint.textContent = 'Point at a document';
    torchBtn.hidden = !cam.hasTorch;
    loop();
  } catch (err) {
    console.error(err);
    stage.replaceChildren(h('div', { class: 'cam-error' },
      h('p', {}, cameraErrorMessage(err)),
      h('button', { class: 'btn primary', onclick: doImport }, 'Import photos')));
    shutter.disabled = true;
  }

  // ---- Detection loop --------------------------------------------------
  // Each animation frame: if the worker isn't busy, send it a small copy of
  // the frame. Only one detection is "in flight" at a time so we never queue
  // up stale frames (that would add lag).
  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (busy || !video.videoWidth) return;
    const k = DETECT_SIZE / Math.max(video.videoWidth, video.videoHeight);
    small.width = Math.round(video.videoWidth * k);
    small.height = Math.round(video.videoHeight * k);
    sctx.drawImage(video, 0, 0, small.width, small.height);
    busy = true;
    detectFrame(sctx.getImageData(0, 0, small.width, small.height))
      .then(onQuad)
      .catch((e) => console.warn('detect', e))
      .finally(() => { busy = false; });
  }

  function onQuad(q) {
    if (!running) return;
    lastQuad = q;
    drawQuad(q);
    if (!q) { history = []; ring.style.setProperty('--p', 0); hint.textContent = 'Point at a document'; return; }
    hint.textContent = autoCapture ? 'Hold steady…' : 'Tap the button to capture';
    // Auto-capture: check the corners barely moved over the last few checks.
    history.push(q);
    if (history.length > STABLE_FRAMES) history.shift();
    const stable = history.length === STABLE_FRAMES && history.every((hq) =>
      hq.every(([x, y], i) => Math.abs(x - q[i][0]) < STABLE_TOLERANCE && Math.abs(y - q[i][1]) < STABLE_TOLERANCE));
    ring.style.setProperty('--p', autoCapture ? history.length / STABLE_FRAMES : 0);
    if (autoCapture && stable && Date.now() > cooldownUntil) capture(true);
  }

  // The <video> uses object-fit: cover (fills the screen, cropping edges), so
  // we must map frame fractions to screen pixels the same way.
  function drawQuad(q) {
    if (!q) { poly.setAttribute('points', ''); return; }
    const r = stage.getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    const s = Math.max(r.width / vw, r.height / vh);
    const ox = (r.width - vw * s) / 2, oy = (r.height - vh * s) / 2;
    svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
    poly.setAttribute('points', q.map(([x, y]) => `${ox + x * vw * s},${oy + y * vh * s}`).join(' '));
  }

  // ---- Capture -----------------------------------------------------------
  async function capture(auto) {
    if (!cam.stream) return;
    cooldownUntil = Date.now() + COOLDOWN_MS;
    history = [];
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    navigator.vibrate?.(30);
    try {
      const { blob, width, height } = await cam.capture();
      let quad = lastQuad ? lastQuad.map(([x, y]) => [x * width, y * height]) : null;
      if (!quad) quad = (await detectBlob(blob)).quad; // try harder on the full photo
      session.pages.push(newPage(blob, quad || fullQuad(width, height), width, height));
      updateTray();
      if (auto) toast(`Page ${session.pages.length} captured`, 1200);
    } catch (err) {
      console.error(err);
      toast(explainError(err));
    }
  }

  function updateTray() {
    const n = session.pages.length;
    count.textContent = n;
    trayBtn.hidden = n === 0;
    if (n) {
      if (thumbImg.src) URL.revokeObjectURL(thumbImg.src);
      thumbImg.src = URL.createObjectURL(session.pages[n - 1].original);
    }
  }

  function updateAuto() { autoBtn.textContent = autoCapture ? 'Auto ✓' : 'Manual'; }
  function toggleAuto() { autoCapture = !autoCapture; history = []; updateAuto(); setSetting('autoCapture', autoCapture); }
  async function toggleTorch() { torch = !torch; await cam.setTorch(torch); torchBtn.textContent = torch ? '⚡ On' : '⚡ Off'; }

  async function doImport() {
    const files = await pickImages();
    if (await importFiles(files)) finish();
  }
  function finish() { if (session.pages.length) go('editor'); }

  // Cleanup runs when leaving the screen: stop the camera (turns off the
  // green indicator dot and saves battery).
  return () => {
    running = false;
    cancelAnimationFrame(raf);
    cam.stop();
    if (thumbImg.src) URL.revokeObjectURL(thumbImg.src);
  };
}
