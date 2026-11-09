// Builds PDFs and JPG exports from saved pages, using pdf-lib (pure JS, offline).
import { PDFDocument } from 'pdf-lib';

// Page sizes in PDF "points" (1 point = 1/72 inch).
const SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };

/**
 * pages: saved page records (each has .processed JPEG Blob + outWidth/outHeight)
 * pageSize: 'a4' | 'letter' | 'legal' | 'fit' (page exactly the image size)
 */
export async function buildPdf(pages, { pageSize = 'a4', title = 'Scan' } = {}) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator('eScanMo');
  pdf.setProducer('eScanMo (on-device)');
  for (const p of pages) {
    // JPEG bytes are embedded as-is (no re-compression = no quality loss).
    const img = await pdf.embedJpg(await p.processed.arrayBuffer());
    const iw = img.width, ih = img.height;
    let pw, ph;
    if (pageSize === 'fit') {
      // Treat the image as 200 dpi so it prints at a natural size.
      pw = (iw / 200) * 72; ph = (ih / 200) * 72;
    } else {
      [pw, ph] = SIZES[pageSize] || SIZES.a4;
      if (iw > ih) [pw, ph] = [ph, pw]; // landscape image -> landscape page
    }
    const page = pdf.addPage([pw, ph]);
    // Scale the image to fit inside the page, keeping its shape, centered.
    const s = Math.min(pw / iw, ph / ih);
    page.drawImage(img, { x: (pw - iw * s) / 2, y: (ph - ih * s) / 2, width: iw * s, height: ih * s });
  }
  const bytes = await pdf.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

export const safeFileName = (name) => (name || 'scan').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'scan';

/**
 * Hands files to the user. On iPhone the Share sheet is best (Save to Files,
 * Photos, AirDrop, Mail…). Falls back to a normal download elsewhere.
 * Safari only allows sharing right after a tap; if our processing took too
 * long and that "permission window" expired, we show a button to tap again.
 */
export async function shareOrDownload(files, title) {
  if (navigator.canShare?.({ files })) {
    try { await navigator.share({ files, title }); return; } catch (err) {
      if (err.name === 'AbortError') return; // user closed the share sheet
      if (err.name === 'NotAllowedError') { await tapToShare(files, title); return; }
      console.warn('share failed, downloading instead', err);
    }
  }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
}

function tapToShare(files, title) {
  return new Promise((resolve) => {
    const sheet = document.createElement('div');
    sheet.className = 'modal sheet';
    sheet.innerHTML = '<div class="sheet-card"><p>Your file is ready.</p><button class="btn primary">Share / Save</button><button class="btn ghost">Cancel</button></div>';
    const [ok, cancel] = sheet.querySelectorAll('button');
    ok.onclick = async () => { sheet.remove(); try { await navigator.share({ files, title }); } catch { /* closed */ } resolve(); };
    cancel.onclick = () => { sheet.remove(); resolve(); };
    document.body.append(sheet);
  });
}
