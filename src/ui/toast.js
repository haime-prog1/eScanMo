// Small helpers for user feedback: a toast message and a busy overlay.
let timer;
export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Shows a blocking spinner with a message while `fn` runs. */
export async function withBusy(message, fn) {
  const el = document.createElement('div');
  el.className = 'busy';
  el.innerHTML = `<div class="spinner"></div><p></p>`;
  el.querySelector('p').textContent = message;
  document.body.append(el);
  const set = (m) => { el.querySelector('p').textContent = m; };
  try { return await fn(set); } finally { el.remove(); }
}

/** Turns technical errors into friendly text. */
export function explainError(err) {
  if (err?.code === 'memory') return 'Your phone ran low on memory. Try fewer pages at once or a lower quality setting.';
  return 'Something went wrong: ' + (err?.message || err);
}

/** Tiny tag helper: h('div', {class:'x', onclick}, child1, 'text') */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
