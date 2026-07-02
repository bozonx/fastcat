import type { WorkerRpcErrorShape } from '~/utils/video-editor/worker-rpc';

export function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(rotation) % 360) + 360) % 360;
  if (normalized >= 45 && normalized < 135) return 90;
  if (normalized >= 135 && normalized < 225) return 180;
  if (normalized >= 225 && normalized < 315) return 270;
  return 0;
}

export function getFinitePositiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getThumbnailSourceWidth(
  imageSource: CanvasImageSource,
  sample: unknown,
  rotation: 0 | 90 | 180 | 270,
): number {
  const frame = sample as {
    codedWidth?: unknown;
    displayWidth?: unknown;
  };
  const source = imageSource as CanvasImageSource & {
    codedWidth?: unknown;
    videoWidth?: unknown;
    naturalWidth?: unknown;
    width?: unknown;
    displayWidth?: unknown;
  };
  const isQuarterTurn = rotation === 90 || rotation === 270;

  return (
    getFinitePositiveNumber(source.codedWidth) ||
    getFinitePositiveNumber(frame.codedWidth) ||
    getFinitePositiveNumber(source.videoWidth) ||
    getFinitePositiveNumber(source.naturalWidth) ||
    getFinitePositiveNumber(source.width) ||
    (isQuarterTurn ? null : getFinitePositiveNumber(source.displayWidth)) ||
    getFinitePositiveNumber(frame.displayWidth) ||
    0
  );
}

export function getThumbnailSourceHeight(
  imageSource: CanvasImageSource,
  sample: unknown,
  rotation: 0 | 90 | 180 | 270,
): number {
  const frame = sample as {
    codedHeight?: unknown;
    displayHeight?: unknown;
  };
  const source = imageSource as CanvasImageSource & {
    codedHeight?: unknown;
    videoHeight?: unknown;
    naturalHeight?: unknown;
    height?: unknown;
    displayHeight?: unknown;
  };
  const isQuarterTurn = rotation === 90 || rotation === 270;

  return (
    getFinitePositiveNumber(source.codedHeight) ||
    getFinitePositiveNumber(frame.codedHeight) ||
    getFinitePositiveNumber(source.videoHeight) ||
    getFinitePositiveNumber(source.naturalHeight) ||
    getFinitePositiveNumber(source.height) ||
    (isQuarterTurn ? null : getFinitePositiveNumber(source.displayHeight)) ||
    getFinitePositiveNumber(frame.displayHeight) ||
    0
  );
}

export function drawRotatedThumbnailFrame(input: {
  ctx: OffscreenCanvasRenderingContext2D;
  imageSource: CanvasImageSource;
  rotation: 0 | 90 | 180 | 270;
  targetW: number;
  targetH: number;
}): void {
  const { ctx, imageSource, rotation, targetW, targetH } = input;

  ctx.save();
  ctx.clearRect(0, 0, targetW, targetH);

  if (rotation === 90) {
    ctx.translate(targetW, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(imageSource, 0, 0, targetH, targetW);
  } else if (rotation === 180) {
    ctx.translate(targetW, targetH);
    ctx.rotate(Math.PI);
    ctx.drawImage(imageSource, 0, 0, targetW, targetH);
  } else if (rotation === 270) {
    ctx.translate(0, targetH);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(imageSource, 0, 0, targetH, targetW);
  } else {
    ctx.drawImage(imageSource, 0, 0, targetW, targetH);
  }

  ctx.restore();
}

export const RENDER_RETRY_LIMITS = {
  MAX_RENDER_RETRIES: 3,
  RENDER_RETRY_DELAY_MS: 50,
} as const;

/**
 * Abstracts the worker's `renderFrame` retry loop over a "single queued request"
 * mailbox — the loop pops the currently queued (timeUs, options) pair, renders
 * it, and only schedules a retry if nothing newer landed in the mailbox while it
 * was awaiting (either the render itself or the retry backoff). A driver backed
 * by real module-level `latest*` variables lets a concurrent `renderFrame` RPC
 * call supersede the in-flight one at any await point; a driver backed by a
 * plain queue lets this run in a unit test with no worker/Pixi context.
 */
export interface RenderRetryLoopDriver {
  /** Pop the currently queued request, clearing it. Null when nothing is queued. */
  takeQueued: () => { timeUs: number; options: unknown } | null;
  /** Peek whether a request is queued, without clearing it. */
  hasQueued: () => boolean;
  /** Queue `timeUs` for a retry attempt (only called when nothing is queued). */
  queueRetry: (timeUs: number) => void;
  /** Render `timeUs`; a non-null/undefined result means the frame presented. */
  render: (timeUs: number, options: unknown) => Promise<unknown>;
  /** Sleep helper — injectable so tests don't wait on real timers. */
  delay: (ms: number) => Promise<void>;
  /** Whether the render target is still alive; false stops scheduling retries. */
  isActive?: () => boolean;
  onError?: (timeUs: number, err: unknown) => void;
}

/**
 * A render can advance internal state (active-clip tracking) yet never reach the
 * canvas — compositor disposed, no renderer, or a lost GL context — and the
 * canvas is rendered to directly (transferControlToOffscreen), so a
 * non-presenting frame leaves the monitor frozen on the previous one with no
 * follow-up to recover. This is most visible with text/shape/HUD clips, which
 * have no per-frame redraw to self-heal. Retry the same time a few times with a
 * short backoff so transient failures recover; a newer queued seek always
 * supersedes a retry.
 */
export async function runRenderRetryLoop(
  driver: RenderRetryLoopDriver,
  limits: { maxRetries?: number; retryDelayMs?: number } = {},
): Promise<null> {
  const maxRetries = limits.maxRetries ?? RENDER_RETRY_LIMITS.MAX_RENDER_RETRIES;
  const retryDelayMs = limits.retryDelayMs ?? RENDER_RETRY_LIMITS.RENDER_RETRY_DELAY_MS;
  let renderRetries = 0;

  let queued = driver.takeQueued();
  while (queued !== null) {
    const { timeUs: next, options } = queued;
    let presented = false;
    try {
      // A non-null result means the frame reached the canvas (a fresh render or
      // the cached early-exit); null means it never presented.
      presented = (await driver.render(next, options)) != null;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') break;
      driver.onError?.(next, err);
    }

    // Presented, or a newer seek arrived while we rendered — either way the
    // screen ends up correct, so drop the retry budget and pick up whatever is
    // now queued (possibly nothing, which ends the loop).
    if (presented || driver.hasQueued()) {
      renderRetries = 0;
      queued = driver.takeQueued();
      continue;
    }

    // Frame never presented and nothing newer is queued: retry the same time
    // after a short backoff instead of leaving the monitor frozen.
    if (renderRetries < maxRetries && (driver.isActive?.() ?? true)) {
      renderRetries += 1;
      await driver.delay(retryDelayMs);
      // Only re-arm if nothing arrived during the backoff — a superseding seek
      // must win over a stale retry.
      if (!driver.hasQueued()) driver.queueRetry(next);
    } else {
      renderRetries = 0;
    }
    queued = driver.takeQueued();
  }

  return null;
}

export function serializeWorkerError(err: unknown): WorkerRpcErrorShape {
  if (err instanceof Error) {
    return {
      name: err.name || 'Error',
      message: err.message,
      cause: 'cause' in err ? err.cause : undefined,
      stack: err.stack,
    };
  }

  return {
    name: 'Error',
    message: String(err),
  };
}

export interface FrameExtractorState {
  source: unknown;
  input: unknown;
  sink: {
    getSample: (timeS: number) => Promise<unknown>;
    close?: () => void;
    dispose?: () => void;
  } | null;
  firstTimestampS: number;
  rotation: number;
  canvas: OffscreenCanvas | null;
  ctx: OffscreenCanvasRenderingContext2D | null;
}

export function disposeFrameExtractorState(state: FrameExtractorState): void {
  const sink = state.sink;
  if (sink) {
    try {
      if (typeof sink.close === 'function') sink.close();
      else if (typeof sink.dispose === 'function') sink.dispose();
    } catch {
      // ignore
    }
  }
  const input = state.input;
  if (input) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inp = input as any;
      if (typeof inp.dispose === 'function') inp.dispose();
      else if (typeof inp.close === 'function') inp.close();
    } catch {
      // ignore
    }
  }
  state.sink = null;
  state.input = null;
  state.source = null;
  state.canvas = null;
  state.ctx = null;
}
