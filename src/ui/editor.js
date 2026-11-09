// Editor: review the scanned batch — reorder, crop, rotate, filter, then save.
import { session, resetSession } from './session.js';
import { processPage } from '../processing/cvClient.js';
import { saveDocument, getSetting, uid } from '../storage/db.js';
import { openCropper } from './cropper.js';
import { h, toast, withBusy, explainError } from './toast.js';
import { go } from './router.js';
import { qualityPreset } from './settings.js';

export const FILTERS = [
  ['original', 'Original'], ['auto', 'Auto'], ['magic', 'Magic Color'],
  ['gray', 'Grayscale'], ['bw', 'B&W'], ['lighten', 'Lighten'],
];

export async function renderEditor(root) {
  if (!session.pages.length) { go('scan'); return; }
  session.current = Math.min(session.current, session.pages.length - 1);
  // Object URLs let an <img> show a Blob. Each one holds memory until revoked,
  // so we reuse one URL per Blob and free them all when leaving the screen.
  const urlCache = new Map();
  const objUrl = (blob) => { if (!urlCache.has(blob)) urlCache.set(blob, URL.createObjectURL(blob)); return urlCache.get(blob); };

  const title = h('div', { class: 'title' });
  const preview = h('img', { class: 'preview', alt: 'Page preview' });
  const spinner = h('div', { class: 'spinner small', hidden: true });
  const strip = h('div', { class: 'strip' });
  const chips = h('div', { class: 'chips' });
  const bright = h('input', { type: 'range', min: -100, max: 100, value: 0 });
  const contr = h('input', { type: 'range', min: -100, max: 100, value: 0 });

  root.append(h('div', { class: 'editor' },
    h('div', { class: 'bar' },
      h('button', { class: 'btn ghost', onclick: discard }, 'Discard'),
      title,
      h('button', { class: 'btn primary', onclick: save }, 'Save')),
    h('div', { class: 'preview-wrap' }, preview, spinner),
    h('div', { class: 'tools-row' },
      h('button', { class: 'tool', onclick: crop }, h('b', {}, '⌗'), 'Crop'),
      h('button', { class: 'tool', onclick: rotate }, h('b', {}, '↻'), 'Rotate'),
      h('button', { class: 'tool', onclick: () => move(-1) }, h('b', {}, '◀'), 'Move'),
      h('button', { class: 'tool', onclick: () => move(1) }, h('b', {}, '▶'), 'Move'),
      h('button', { class: 'tool', onclick: remove }, h('b', {}, '🗑'), 'Delete')),
    chips,
    h('div', { class: 'sliders' },
      h('label', {}, h('span', {}, 'Brightness'), bright),
      h('label', {}, h('span', {}, 'Contrast'), contr),
      h('button', { class: 'btn small', onclick: applyAll }, 'Apply to all')),
    strip));

  FILTERS.forEach(([key, label]) => chips.append(h('button', { class: 'chip', 'data-f': key, onclick: () => setFilter(key) }, label)));

  // Sliders update the preview after the finger pauses (debounce), so we
  // don't flood the worker with dozens of re-renders per second.
  let sliderTimer;
  const onSlide = () => {
    const p = page(); p.brightness = +bright.value; p.contrast = +contr.value; p.dirty = true;
    clearTimeout(sliderTimer); sliderTimer = setTimeout(() => renderPreview(p), 180);
  };
  bright.addEventListener('input', onSlide);
  contr.addEventListener('input', onSlide);

  const page = () => session.pages[session.current];
  showPage();
  // Render small thumbnails for the strip in the background.
  session.pages.forEach((p) => { if (!p.thumb || p.dirty) renderPreview(p, true); });

  function showPage() {
    const p = page();
    title.textContent = `Page ${session.current + 1} of ${session.pages.length}`;
    bright.value = p.brightness; contr.value = p.contrast;
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.f === p.filter));
    if (p._preview) preview.src = p._preview; else preview.removeAttribute('src');
    renderPreview(p);
    renderStrip();
  }

  function renderStrip() {
    strip.replaceChildren(...session.pages.map((p, i) => h('button', {
      class: 'thumb' + (i === session.current ? ' on' : ''),
      onclick: () => { session.current = i; showPage(); },
    }, p.thumb ? h('img', { src: objUrl(p.thumb), alt: `Page ${i + 1}` }) : h('span', {}, i + 1), h('i', {}, i + 1))),
    h('button', { class: 'thumb add', onclick: () => go('scan'), 'aria-label': 'Add pages' }, '+'));
  }

  // Preview = the full pipeline at reduced size (fast). A "version" number
  // makes sure a slow, older render never overwrites a newer one.
  async function renderPreview(p, thumbOnly = false) {
    const key = JSON.stringify([p.quad, p.filter, p.brightness, p.contrast, p.rotation]);
    if (p._key === key && (thumbOnly || p._preview)) { if (p === page()) preview.src = p._preview; return; }
    // Thumbnails and full previews keep separate counters so one never cancels the other.
    const vk = thumbOnly ? '_tver' : '_ver';
    const ver = (p[vk] || 0) + 1; p[vk] = ver;
    if (p === page() && !thumbOnly) spinner.hidden = false;
    try {
      const r = await processPage({ blob: p.original, quad: p.quad, filter: p.filter, brightness: p.brightness, contrast: p.contrast, rotation: p.rotation, maxDim: thumbOnly ? 500 : 1400, quality: 0.8, thumbSize: 240 });
      if (p[vk] !== ver) return; // a newer render started meanwhile
      p.thumb = r.thumb;
      if (!thumbOnly) { p._preview = objUrl(r.blob); p._key = key; }
      if (p === page() && !thumbOnly) preview.src = p._preview;
      renderStrip();
    } catch (err) {
      console.error(err);
      toast(explainError(err));
    } finally {
      if (p === page() && !thumbOnly && p._ver === ver) spinner.hidden = true;
    }
  }

  function setFilter(f) { const p = page(); p.filter = f; p.dirty = true; showPage(); }
  function rotate() { const p = page(); p.rotation = (p.rotation + 90) % 360; p.dirty = true; renderPreview(p); }
  async function crop() {
    const p = page();
    const q = await openCropper(p);
    if (q) { p.quad = q; p.dirty = true; renderPreview(p); }
  }
  function move(dir) {
    const i = session.current, j = i + dir;
    if (j < 0 || j >= session.pages.length) return;
    [session.pages[i], session.pages[j]] = [session.pages[j], session.pages[i]];
    session.current = j; showPage();
  }
  function remove() {
    if (!confirm('Delete this page?')) return;
    session.pages.splice(session.current, 1);
    if (!session.pages.length) { resetSession(); go('home'); return; }
    session.current = Math.min(session.current, session.pages.length - 1);
    showPage();
  }
  function applyAll() {
    const p = page();
    session.pages.forEach((o) => { o.filter = p.filter; o.brightness = p.brightness; o.contrast = p.contrast; o.dirty = true; });
    session.pages.forEach((o) => renderPreview(o, o !== p));
    toast('Applied to all pages');
  }
  function discard() {
    if (!confirm(session.docId ? 'Discard your changes?' : 'Discard this scan?')) return;
    const back = session.docId ? 'doc/' + session.docId : 'home';
    resetSession(); go(back);
  }

  // Save: re-run every changed page at full export quality, then store.
  async function save() {
    const preset = qualityPreset(await getSetting('quality', 'high'));
    try {
      const doc = await withBusy('Saving…', async (set) => {
        const pages = [];
        for (const [i, p] of session.pages.entries()) {
          set(`Processing page ${i + 1} of ${session.pages.length}…`);
          if (p.dirty || !p.processed) {
            const r = await processPage({ blob: p.original, quad: p.quad, filter: p.filter, brightness: p.brightness, contrast: p.contrast, rotation: p.rotation, maxDim: preset.maxDim, quality: preset.quality, thumbSize: 320 });
            Object.assign(p, { processed: r.blob, thumb: r.thumb, outWidth: r.width, outHeight: r.height, dirty: false });
          }
          // Strip the temporary preview fields (underscore = not saved).
          const { _preview, _key, _ver, _tver, ...clean } = p;
          pages.push(clean);
        }
        const now = Date.now();
        const base = session.docId ? { id: session.docId, name: session.docName, createdAt: session.createdAt || now }
          : { id: uid(), name: defaultName(), createdAt: now, favorite: false, folderId: null, tags: [] };
        return saveDocument({ ...base, ...(session.docMeta || {}), id: base.id, name: base.name }, pages);
      });
      resetSession();
      toast('Saved');
      go('doc/' + doc.id);
    } catch (err) {
      console.error(err);
      toast(explainError(err), 5000);
    }
  }

  return () => {
    urlCache.forEach((u) => URL.revokeObjectURL(u));
    session.pages.forEach((p) => { delete p._preview; delete p._key; });
  };
}

function defaultName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Scan ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
}
