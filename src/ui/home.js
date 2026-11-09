// Home: list of saved documents + quick Scan / Import buttons.
import { listDocuments, db } from '../storage/db.js';
import { resetSession } from './session.js';
import { pickImages, importFiles } from '../camera/importer.js';
import { h } from './toast.js';
import { go } from './router.js';

export async function renderHome(root) {
  const docs = await listDocuments();
  const urls = [];
  const d = await db();

  const list = h('div', { class: 'doc-list' });
  root.append(h('div', { class: 'page' },
    h('header', { class: 'home-head' }, h('h1', {}, 'eScanMo'), h('p', { class: 'muted' }, 'Scans stay on this device.')),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary big', onclick: () => { resetSession(); go('scan'); } }, '◉  Scan'),
      h('button', { class: 'btn big', onclick: doImport }, '⇪  Import')),
    docs.length ? list : h('div', { class: 'empty' }, h('p', {}, 'No documents yet.'), h('p', { class: 'muted' }, 'Tap Scan to photograph a page, or Import to use photos you already have.'))));

  for (const doc of docs) {
    const first = doc.pageIds[0] && (await d.get('pages', doc.pageIds[0]));
    let img = h('div', { class: 'ph' });
    if (first?.thumb) { const u = URL.createObjectURL(first.thumb); urls.push(u); img = h('img', { src: u, alt: '' }); }
    list.append(h('button', { class: 'doc-row', onclick: () => go('doc/' + doc.id) }, img,
      h('div', {}, h('strong', {}, doc.name), h('span', { class: 'muted' }, `${doc.pageIds.length} page${doc.pageIds.length === 1 ? '' : 's'} · ${new Date(doc.updatedAt).toLocaleDateString()}`))));
  }

  async function doImport() {
    resetSession();
    if (await importFiles(await pickImages())) go('editor');
  }
  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}
