// Shared camera-scan plumbing for every page that reads plates from a <video>.
//
// Three things every scanner needs, and used to do with a fixed setInterval:
//   1. a loop that sends the next frame as soon as the last answer is back
//      (a 700 ms timer made the user wait even when the server took 250 ms);
//   2. a gate that decides whether this frame is worth sending at all;
//   3. a small JPEG — the detector resizes to 608 px anyway, so a full-size
//      upload only costs mobile bandwidth.

import { useEffect, useRef } from "react";

/** Region of the video to use, as fractions of its width/height. */
export type Crop = { x: number; y: number; w: number; h: number };
export const FULL: Crop = { x: 0, y: 0, w: 1, h: 1 };

// Thumbnail used only for motion/change measurement: small enough that the
// comparison costs well under a millisecond, big enough to see a car move.
const THUMB_W = 64;
const THUMB_H = 36;
// Poll interval while the gate is skipping frames.
const IDLE_MS = 100;

let thumbCanvas: HTMLCanvasElement | null = null;

function thumbnail(video: HTMLVideoElement, crop: Crop): Float32Array {
  // Created lazily: this module is imported by pages that also render on the server.
  thumbCanvas ??= document.createElement("canvas");
  thumbCanvas.width = THUMB_W;
  thumbCanvas.height = THUMB_H;
  const ctx = thumbCanvas.getContext("2d", { willReadFrequently: true })!;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  ctx.drawImage(video, vw * crop.x, vh * crop.y, vw * crop.w, vh * crop.h, 0, 0, THUMB_W, THUMB_H);
  const px = ctx.getImageData(0, 0, THUMB_W, THUMB_H).data;
  const grey = new Float32Array(THUMB_W * THUMB_H);
  for (let i = 0; i < grey.length; i++) {
    grey[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  }
  return grey;
}

/** Mean absolute grey-level difference, 0–255. */
function difference(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * Hand-held phone: send only when the picture holds still.
 *
 * A moving phone gives a blurred plate, and blurred plates are where OCR
 * misreads (JXK830 → JXK118). Waiting for a steady frame both saves server
 * work and sends only frames worth reading. `maxWaitMs` stops a shaky hand
 * from never getting a read at all.
 */
export class StableGate {
  private prev: Float32Array | null = null;
  private lastSent = 0;
  motion = 0;

  constructor(
    private crop: Crop,
    private threshold = 6,
    // Matches the old fixed interval, so a shaky hand is never slower than before.
    private maxWaitMs = 700,
  ) {}

  shouldSend(video: HTMLVideoElement): boolean {
    const cur = thumbnail(video, this.crop);
    this.motion = this.prev ? difference(cur, this.prev) : 255;
    this.prev = cur;
    const now = performance.now();
    const send = this.motion < this.threshold || now - this.lastSent > this.maxWaitMs;
    if (send) this.lastSent = now;
    return send;
  }
}

/**
 * Fixed camera: send only when the scene changed since the last sent frame.
 *
 * A parked car looks the same for hours; re-reading it every second burns
 * ~250 ms of server CPU per call for nothing. `heartbeatMs` still sends now
 * and then, because the answer includes payment status, which can change
 * while the picture does not.
 */
export class ChangeGate {
  private ref: Float32Array | null = null;
  private lastSent = 0;
  change = 0;

  constructor(
    private crop: Crop = FULL,
    private threshold = 6,
    private heartbeatMs = 5000,
  ) {}

  shouldSend(video: HTMLVideoElement): boolean {
    const cur = thumbnail(video, this.crop);
    this.change = this.ref ? difference(cur, this.ref) : 255;
    const now = performance.now();
    const send = this.change > this.threshold || now - this.lastSent > this.heartbeatMs;
    if (send) {
      this.ref = cur;
      this.lastSent = now;
    }
    return send;
  }
}

/** Crop, downscale and JPEG-encode the current video frame. */
export async function captureJpeg(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  crop: Crop,
  maxWidth: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const sw = video.videoWidth * crop.w;
  const sh = video.videoHeight * crop.h;
  const scale = Math.min(1, maxWidth / sw);
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas
    .getContext("2d")!
    .drawImage(
      video,
      video.videoWidth * crop.x,
      video.videoHeight * crop.y,
      sw,
      sh,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/jpeg", quality));
  return { blob, width: canvas.width, height: canvas.height };
}

/**
 * Run `step` back-to-back while `enabled`. `step` returns true if it sent a
 * frame; when it skipped (gate said no, video not ready) the loop idles
 * briefly instead of spinning.
 */
export function useScanLoop(step: () => Promise<boolean>, enabled: boolean) {
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    (async () => {
      while (!stopped) {
        let sent = false;
        try {
          sent = await stepRef.current();
        } catch {
          // transient network error — the next pass retries
        }
        // Yield a frame even after a send so React can paint the result.
        await new Promise((r) => setTimeout(r, sent ? 16 : IDLE_MS));
      }
    })();
    return () => {
      stopped = true;
    };
  }, [enabled]);
}

/** `?debug` in the URL shows gate + timing numbers on the scan pages. */
export function scanDebugEnabled(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("debug");
}
