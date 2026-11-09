# eScanMo

Offline, on-device document scanner PWA (iPhone-first). Photos → clean PDFs, nothing uploaded.

## Run it
```bash
npm install          # also copies OpenCV.js into public/vendor
npm run dev          # https://<your-computer-ip>:5173 (mkcert certificate)
npm run build        # production build in dist/
npm run preview      # serve the build over https (service worker active)
```

### Testing on iPhone
1. Phone and computer on the same Wi-Fi. Run `npm run dev` and open the "Network" URL in Safari.
2. The mkcert certificate is trusted on your computer only. On the iPhone, either tap through
   the warning, or install mkcert's root CA (`mkcert -CAROOT` shows where it is): AirDrop
   `rootCA.pem` to the phone → Settings → Profile Downloaded → Install, then
   Settings → General → About → Certificate Trust Settings → turn it on.
3. Allow camera access when prompted. Requires iOS 16.4+.

## Layout
- `src/camera` camera, scan screen, photo import
- `src/processing` main-thread client for the OpenCV worker
- `src/workers` OpenCV worker (edge detection, warp, filters)
- `src/pdf` PDF/JPG export
- `src/storage` IndexedDB (documents, pages, settings)
- `src/ui` screens and shared UI helpers
- `src/ocr` OCR (Phase 2)
