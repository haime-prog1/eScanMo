// Settings tab: export quality, PDF page size, auto-capture, theme, storage.
import { getSetting, setSetting } from '../storage/db.js';
import { h } from './toast.js';

// Quality presets: longest side in pixels + JPEG quality (0..1).
// Bigger = sharper but larger files and more memory while processing.
const QUALITY = {
  standard: { label: 'Standard (smaller files)', maxDim: 1800, quality: 0.8 },
  high: { label: 'High', maxDim: 2600, quality: 0.88 },
  max: { label: 'Maximum (HD)', maxDim: 3600, quality: 0.94 },
};
export const qualityPreset = (k) => QUALITY[k] || QUALITY.high;

/** Theme: 'system' follows the iPhone's light/dark setting. */
export async function applyTheme(theme) {
  theme ??= await getSetting('theme', 'system');
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
}

function select(label, key, options, current, onChange) {
  const sel = h('select', { onchange: async (e) => { await setSetting(key, e.target.value); onChange?.(e.target.value); } },
    Object.entries(options).map(([v, t]) => h('option', { value: v, selected: v === current }, t)));
  return h('label', { class: 'setting' }, h('span', {}, label), sel);
}

export async function renderSettings(root) {
  const [quality, pageSize, theme, auto] = await Promise.all([
    getSetting('quality', 'high'), getSetting('pageSize', 'a4'), getSetting('theme', 'system'), getSetting('autoCapture', true)]);

  const autoBox = h('input', { type: 'checkbox', checked: auto, onchange: (e) => setSetting('autoCapture', e.target.checked) });
  const storage = h('p', { class: 'muted' }, 'Checking storage…');

  root.append(h('div', { class: 'page' }, h('h1', {}, 'Settings'),
    h('section', { class: 'settings' },
      select('Export quality', 'quality', Object.fromEntries(Object.entries(QUALITY).map(([k, v]) => [k, v.label])), quality),
      select('PDF page size', 'pageSize', { a4: 'A4', letter: 'US Letter', legal: 'Legal', fit: 'Fit to image' }, pageSize),
      h('label', { class: 'setting' }, h('span', {}, 'Auto-capture'), autoBox),
      select('Appearance', 'theme', { system: 'Match iPhone', light: 'Light', dark: 'Dark' }, theme, applyTheme)),
    h('h2', {}, 'Storage'), storage,
    h('h2', {}, 'About'),
    h('p', { class: 'muted' }, 'eScanMo processes everything on your device. No account, no uploads, works offline.')));

  // Show how much space scans use (estimate from the browser).
  try {
    const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) || {};
    const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
    storage.textContent = quota ? `Using ${mb(usage)} of about ${mb(quota)} available.` : 'Storage info unavailable.';
  } catch { storage.textContent = 'Storage info unavailable.'; }
}
