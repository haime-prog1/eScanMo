// App entry point: sets up the theme, the bottom tab bar, a tiny hash-based
// router (#/home, #/scan, #/doc/<id> ...) and the service worker.
import './styles.css';
import { renderHome } from './ui/home.js';
import { renderScan } from './camera/scanView.js';
import { renderEditor } from './ui/editor.js';
import { renderDoc } from './ui/docView.js';
import { renderTools } from './ui/tools.js';
import { renderSettings, applyTheme } from './ui/settings.js';
import { requestPersistence } from './storage/db.js';
import { toast } from './ui/toast.js';

const view = document.getElementById('view');
const routes = {
  home: renderHome,
  scan: renderScan,
  editor: renderEditor,
  doc: renderDoc,
  tools: renderTools,
  settings: renderSettings,
};
// Full-screen screens hide the tab bar so the camera/editor get all the room.
const immersive = new Set(['scan', 'editor']);

let cleanup = null;

import { go } from './ui/router.js';

async function route() {
  const [name = 'home', ...params] = location.hash.replace(/^#\/?/, '').split('/');
  const render = routes[name] || renderHome;
  // Let the previous screen release resources (e.g. stop the camera).
  if (cleanup) { try { await cleanup(); } catch (e) { console.warn(e); } cleanup = null; }
  view.replaceChildren();
  document.body.classList.toggle('immersive', immersive.has(name));
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name || (name === 'doc' && b.dataset.tab === 'home')));
  try {
    cleanup = (await render(view, ...params.map(decodeURIComponent))) || null;
  } catch (err) {
    console.error(err);
    toast('Could not open this screen: ' + err.message);
  }
}

document.getElementById('tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) go(b.dataset.tab);
});
window.addEventListener('hashchange', route);

applyTheme();
requestPersistence();
route();

// Register the service worker only in production builds (in dev it would
// cache files and hide your code changes).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW failed', e)));
}
