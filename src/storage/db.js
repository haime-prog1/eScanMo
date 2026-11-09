// All app data lives in IndexedDB on the phone (nothing is uploaded).
// We use the small "idb" library, which wraps IndexedDB's old callback API in
// Promises so we can use async/await.
import { openDB } from 'idb';

const DB_NAME = 'escanmo';
const DB_VERSION = 1;

let dbPromise;
export function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      // upgrade() runs only when the DB is first created or DB_VERSION goes up.
      // This is where "tables" (object stores) and indexes are defined.
      upgrade(d) {
        const docs = d.createObjectStore('documents', { keyPath: 'id' });
        docs.createIndex('updatedAt', 'updatedAt');
        const pages = d.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('docId', 'docId');
        d.createObjectStore('signatures', { keyPath: 'id' });
        d.createObjectStore('settings'); // simple key -> value
      },
    });
  }
  return dbPromise;
}

export const uid = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

// ---- Documents -----------------------------------------------------------
export async function listDocuments() {
  const all = await (await db()).getAll('documents');
  return all.sort((a, b) => b.updatedAt - a.updatedAt); // newest first
}
export async function getDocument(id) { return (await db()).get('documents', id); }

/**
 * Saves a document and its pages in ONE transaction, so we never end up with
 * half-saved data if the app is closed mid-save.
 * `pages` is the ordered array; their order is stored in doc.pageIds.
 */
export async function saveDocument(doc, pages) {
  const d = await db();
  const tx = d.transaction(['documents', 'pages'], 'readwrite');
  const pageStore = tx.objectStore('pages');
  // Remove pages that were deleted in the editor.
  const oldIds = await pageStore.index('docId').getAllKeys(doc.id);
  const keep = new Set(pages.map((p) => p.id));
  for (const id of oldIds) if (!keep.has(id)) await pageStore.delete(id);
  for (const p of pages) await pageStore.put({ ...p, docId: doc.id });
  doc.pageIds = pages.map((p) => p.id);
  doc.updatedAt = Date.now();
  await tx.objectStore('documents').put(doc);
  await tx.done;
  return doc;
}

export async function getPages(doc) {
  const d = await db();
  const pages = await Promise.all(doc.pageIds.map((id) => d.get('pages', id)));
  return pages.filter(Boolean);
}

export async function deleteDocument(id) {
  const d = await db();
  const tx = d.transaction(['documents', 'pages'], 'readwrite');
  const ids = await tx.objectStore('pages').index('docId').getAllKeys(id);
  for (const pid of ids) await tx.objectStore('pages').delete(pid);
  await tx.objectStore('documents').delete(id);
  await tx.done;
}

export async function renameDocument(id, name) {
  const d = await db();
  const doc = await d.get('documents', id);
  if (!doc) return;
  doc.name = name; doc.updatedAt = Date.now();
  await d.put('documents', doc);
}

// ---- Settings ------------------------------------------------------------
export async function getSetting(key, fallback) {
  const v = await (await db()).get('settings', key);
  return v === undefined ? fallback : v;
}
export async function setSetting(key, value) { return (await db()).put('settings', value, key); }

// Ask the browser not to evict our data when storage is low. Safari may still
// say no, but asking costs nothing.
export async function requestPersistence() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
