// The "draft" being scanned/edited, shared between the camera and editor
// screens. It lives in memory only until the user taps Save.
import { uid } from '../storage/db.js';

export const session = {
  docId: null,   // set when editing an existing document
  docName: null,
  pages: [],     // ordered list of page objects (see newPage)
  current: 0,    // index of the page shown in the editor
};

/** A page keeps the ORIGINAL photo plus the edit settings, so every edit can be
 *  redone or undone later without losing quality. */
export function newPage(original, quad, width, height) {
  return {
    id: uid(), original, quad, width, height,
    filter: 'auto', brightness: 0, contrast: 0, rotation: 0,
    processed: null, thumb: null, dirty: true,
  };
}

export function resetSession() {
  session.docId = null; session.docName = null; session.pages = []; session.current = 0;
}

/** Corners covering the whole image — used when no page edge was found. */
export const fullQuad = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
