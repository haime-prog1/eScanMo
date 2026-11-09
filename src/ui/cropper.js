// 4-corner crop editor. Shows the original photo with 4 draggable handles.
// While dragging, a magnifier bubble shows a zoomed view under your finger
// (your fingertip would otherwise hide the exact corner).
import { h } from './toast.js';
import { detectBlob } from '../processing/cvClient.js';
import { fullQuad } from './session.js';

/** Opens the cropper for a page. Resolves with the new quad, or null if cancelled. */
export function openCropper(page) {
  return new Promise((resolve) => {
    let quad = page.quad.map((p) => [...p]);
    const url = URL.createObjectURL(page.original);
    const img = h('img', { src: url, alt: 'Page photo', draggable: 'false' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('crop-svg');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    svg.append(poly);
    const handles = [0, 1, 2, 3].map((i) => h('div', { class: 'handle', 'data-i': i }));
    const mag = h('canvas', { class: 'magnifier', width: 240, height: 240 });
    const stage = h('div', { class: 'crop-stage' }, img, svg, ...handles, mag);

    const close = (result) => { URL.revokeObjectURL(url); window.removeEventListener('resize', layout); modal.remove(); resolve(result); };
    const modal = h('div', { class: 'modal crop-modal' },
      h('div', { class: 'bar' },
        h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Cancel'),
        h('div', { class: 'bar-group' },
          h('button', { class: 'btn ghost', onclick: autoDetect }, 'Auto'),
          h('button', { class: 'btn ghost', onclick: () => { quad = fullQuad(page.width, page.height); layout(); } }, 'Full')),
        h('button', { class: 'btn primary', onclick: () => close(quad) }, 'Done')),
      stage,
      h('p', { class: 'crop-tip' }, 'Drag the corners to the edges of the page'));
    document.body.append(modal);

    // Where the image sits on screen ("contain" fit) — recomputed on resize.
    let box = { x: 0, y: 0, s: 1 };
    function layout() {
      const r = stage.getBoundingClientRect();
      const s = Math.min(r.width / page.width, r.height / page.height);
      box = { x: (r.width - page.width * s) / 2, y: (r.height - page.height * s) / 2, s };
      Object.assign(img.style, { left: box.x + 'px', top: box.y + 'px', width: page.width * s + 'px', height: page.height * s + 'px' });
      svg.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`);
      draw();
    }
    const toScreen = ([x, y]) => [box.x + x * box.s, box.y + y * box.s];
    function draw() {
      poly.setAttribute('points', quad.map((p) => toScreen(p).join(',')).join(' '));
      handles.forEach((el, i) => { const [x, y] = toScreen(quad[i]); el.style.transform = `translate(${x}px, ${y}px)`; });
    }

    // Pointer events work for both touch and mouse. setPointerCapture keeps
    // sending moves to the handle even if the finger slides off it.
    let active = -1, grabOffset = [0, 0];
    stage.addEventListener('pointerdown', (e) => {
      const r = stage.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      // Pick the nearest corner within 60px (generous for thumbs).
      let best = -1, bestD = 60;
      quad.forEach((p, i) => { const [x, y] = toScreen(p); const d = Math.hypot(x - px, y - py); if (d < bestD) { bestD = d; best = i; } });
      if (best < 0) return;
      active = best;
      const [hx, hy] = toScreen(quad[best]);
      grabOffset = [hx - px, hy - py]; // so the corner doesn't "jump" to the finger
      stage.setPointerCapture(e.pointerId);
      handles[best].classList.add('active');
      move(e);
    });
    stage.addEventListener('pointermove', (e) => { if (active >= 0) move(e); });
    const end = () => { if (active < 0) return; handles[active].classList.remove('active'); active = -1; mag.style.display = 'none'; };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    function move(e) {
      const r = stage.getBoundingClientRect();
      const sx = e.clientX - r.left + grabOffset[0], sy = e.clientY - r.top + grabOffset[1];
      // Convert screen -> image pixels and keep inside the photo.
      const x = Math.min(page.width, Math.max(0, (sx - box.x) / box.s));
      const y = Math.min(page.height, Math.max(0, (sy - box.y) / box.s));
      quad[active] = [x, y];
      draw();
      drawMagnifier(x, y, sx, sy, r);
    }

    function drawMagnifier(x, y, sx, sy, r) {
      const ctx = mag.getContext('2d');
      const zoom = 3, size = mag.width, srcSize = size / zoom / box.s; // image px shown
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, x - srcSize / 2, y - srcSize / 2, srcSize, srcSize, 0, 0, size, size);
      ctx.strokeStyle = '#ffb547'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
      // Show it above the finger; flip below when near the top edge.
      const d = 120;
      const top = sy - d - 70 < 0 ? sy + 40 : sy - d - 70;
      const left = Math.min(r.width - d - 4, Math.max(4, sx - d / 2));
      Object.assign(mag.style, { display: 'block', left: left + 'px', top: top + 'px' });
    }

    async function autoDetect() {
      try {
        const { quad: q } = await detectBlob(page.original);
        if (q) { quad = q; layout(); }
      } catch (e) { console.warn(e); }
    }

    if (img.complete) layout(); else img.onload = layout;
    window.addEventListener('resize', layout);
  });
}
