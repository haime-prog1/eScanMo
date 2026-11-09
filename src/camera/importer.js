// Import existing photos (camera roll) or image files instead of using the camera.
import { detectBlob } from '../processing/cvClient.js';
import { session, newPage, fullQuad } from '../ui/session.js';
import { withBusy, toast, explainError } from '../ui/toast.js';

/** Opens the iOS photo/file picker. Resolves with the chosen File list. */
export function pickImages() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}

/** Adds files to the current draft, auto-detecting page corners for each. */
export async function importFiles(files) {
  if (!files.length) return 0;
  let added = 0;
  await withBusy('Importing…', async (set) => {
    for (const [i, file] of files.entries()) {
      set(`Finding page edges ${i + 1}/${files.length}…`);
      try {
        const { width, height, quad } = await detectBlob(file);
        session.pages.push(newPage(file, quad || fullQuad(width, height), width, height));
        added++;
      } catch (err) {
        console.error(err);
        toast(`Skipped ${file.name}: ${explainError(err)}`);
      }
    }
  });
  return added;
}
