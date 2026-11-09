// Thin wrapper around the browser camera (getUserMedia).
export class Camera {
  constructor(video) { this.video = video; this.stream = null; this.track = null; }

  async start() {
    if (!window.isSecureContext) {
      const e = new Error('The camera only works over HTTPS.'); e.name = 'InsecureContext'; throw e;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      const e = new Error('This browser has no camera access.'); e.name = 'NotSupportedError'; throw e;
    }
    // Ask for the BACK camera at high resolution. "ideal" means "try, but
    // accept less" — iPhones usually give 1920x1080 or up to 4K for video.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    this.track = this.stream.getVideoTracks()[0];
    this.video.srcObject = this.stream;
    // iOS needs playsinline + muted or the video goes fullscreen / won't play.
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    // Wait until real frame dimensions are known.
    if (!this.video.videoWidth) await new Promise((r) => this.video.addEventListener('loadedmetadata', r, { once: true }));
  }

  get hasTorch() { return !!this.track?.getCapabilities?.().torch; }
  async setTorch(on) { try { await this.track.applyConstraints({ advanced: [{ torch: on }] }); } catch { /* unsupported */ } }

  /** Grab the current frame at full video resolution as a JPEG Blob. */
  async capture() {
    const v = this.video;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95));
    c.width = c.height = 0; // free the canvas memory right away (helps on iOS)
    return { blob, width: v.videoWidth, height: v.videoHeight };
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.stream = null; this.track = null;
  }
}

/** Human-friendly explanation for camera errors. */
export function cameraErrorMessage(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was denied. On iPhone: Settings → Safari → Camera → Allow (or tap "aA" in the address bar → Website Settings). You can still import photos below.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device. You can import photos instead.';
    case 'NotReadableError':
      return 'The camera is busy in another app. Close it and try again.';
    case 'InsecureContext':
      return 'The camera needs a secure (https://) connection. Open the app via its https address.';
    default:
      return 'Could not start the camera: ' + (err?.message || err);
  }
}
