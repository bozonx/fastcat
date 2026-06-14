/**
 * Shared, frame-budgeted scheduler for waveform canvas redraws.
 *
 * Each timeline clip used to own an independent `requestAnimationFrame` loop, so
 * a zoom or scroll that touched N clips produced N rAF callbacks competing in the
 * same frame — and a single frame could run every clip's redraw back-to-back,
 * blowing the frame budget and janking. This scheduler coalesces all clip
 * redraws into one rAF callback keyed by clip, and spreads the work across frames
 * with a soft time budget so one heavy frame (e.g. right after a zoom) degrades
 * into a couple of cheap frames instead of a stutter.
 */

type RedrawJob = () => void;

/** Soft per-frame budget; once exceeded, remaining jobs roll to the next frame. */
const FRAME_BUDGET_MS = 8;

const jobs = new Map<string, RedrawJob>();
let frameId = 0;

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function flush(): void {
  frameId = 0;
  const start = now();
  // Iterate a snapshot of keys so jobs re-scheduling themselves don't loop forever
  // within a single frame.
  for (const key of Array.from(jobs.keys())) {
    const job = jobs.get(key);
    if (!job) continue;
    jobs.delete(key);
    try {
      job();
    } catch {
      // A single clip's draw failure must not abort the rest of the frame.
    }
    if (jobs.size > 0 && now() - start > FRAME_BUDGET_MS) {
      ensureFrame();
      break;
    }
  }
}

function ensureFrame(): void {
  if (frameId) return;
  if (typeof requestAnimationFrame === 'undefined') {
    // Non-DOM (SSR/worker/test) fallback: run synchronously on next microtask.
    frameId = -1;
    queueMicrotask(() => {
      if (frameId === -1) flush();
    });
    return;
  }
  frameId = requestAnimationFrame(flush);
}

/** Queue (or replace) a clip's redraw job. Coalesced by `key` until the next frame. */
export function scheduleWaveformRedraw(key: string, job: RedrawJob): void {
  jobs.set(key, job);
  ensureFrame();
}

/** Drop a pending redraw (e.g. when a clip unmounts). */
export function cancelWaveformRedraw(key: string): void {
  jobs.delete(key);
}

/** Test-only: clear all pending work and cancel the scheduled frame. */
export function __resetWaveformSchedulerForTests(): void {
  jobs.clear();
  if (frameId > 0 && typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(frameId);
  }
  frameId = 0;
}
