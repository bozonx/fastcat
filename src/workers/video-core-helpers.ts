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
