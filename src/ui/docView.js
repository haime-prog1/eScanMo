// One document: page grid + actions (edit, export PDF/JPG, rename, delete).
import { getDocument, getPages, deleteDocument, renameDocument, getSetting } from '../storage/db.js';
import { session, resetSession } from './session.js';
import { buildPdf, shareOrDownload, safeFileName } from '../pdf/exportPdf.js';
import { h, toast, withBusy, explainError } from './toast.js';
import { go } from './router.js';

export async function renderDoc(root, id) {
  const doc = await getDocument(id);
  if (!doc) { toast('Document not found'); go('home'); return; }
  const pages = await getPages(doc);
  const urls = [];
  const url = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };

  const name = h('h1', { class: 'doc-title' }, doc.name);
  root.append(h('div', { class: 'page doc' },
    h('div', { class: 'bar' },
      h('button', { class: 'btn ghost', onclick: () => go('home') }, '‹ Back'),
      h('button', { class: 'btn ghost', onclick: rename }, 'Rename')),
    name,
    h('p', { class: 'muted' }, `${pages.length} page${pages.length === 1 ? '' : 's'} · ${new Date(doc.updatedAt).toLocaleString()}`),
    h('div', { class: 'actions' },
      h('button', { class: 'btn primary', onclick: exportPdf }, 'Export PDF'),
      h('button', { class: 'btn', onclick: exportJpg }, 'Export JPG'),
      h('button', { class: 'btn', onclick: edit }, 'Edit'),
      h('button', { class: 'btn danger', onclick: del }, 'Delete')),
    h('div', { class: 'grid' }, pages.map((p, i) =>
      h('figure', { class: 'card' }, h('img', { src: url(p.thumb || p.processed), alt: `Page ${i + 1}`, loading: 'lazy' }), h('figcaption', {}, i + 1))))));

  async function exportPdf() {
    try {
      const pageSize = await getSetting('pageSize', 'a4');
      const blob = await withBusy('Creating PDF…', () => buildPdf(pages, { pageSize, title: doc.name }));
      await shareOrDownload([new File([blob], safeFileName(doc.name) + '.pdf', { type: 'application/pdf' })], doc.name);
    } catch (err) { console.error(err); toast(explainError(err)); }
  }
  async function exportJpg() {
    const base = safeFileName(doc.name);
    const files = pages.map((p, i) => new File([p.processed], pages.length > 1 ? `${base}-${i + 1}.jpg` : `${base}.jpg`, { type: 'image/jpeg' }));
    await shareOrDownload(files, doc.name);
  }
  function edit() {
    // Load pages back into the draft. Originals are kept, so crops/filters can
    // be changed without any quality loss.
    resetSession();
    session.docId = doc.id; session.docName = doc.name; session.createdAt = doc.createdAt;
    session.docMeta = doc;
    session.pages = pages.map((p) => ({ ...p, dirty: false }));
    go('editor');
  }
  async function rename() {
    const n = prompt('Document name', doc.name);
    if (!n?.trim()) return;
    doc.name = n.trim(); await renameDocument(doc.id, doc.name); name.textContent = doc.name;
  }
  async function del() {
    if (!confirm(`Delete "${doc.name}"? This cannot be undone.`)) return;
    await deleteDocument(doc.id); toast('Deleted'); go('home');
  }
  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}
