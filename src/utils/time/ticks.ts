/** Premiere-compatible canonical timeline timebase. */
export const TICKS_PER_SECOND = 254_016_000_000;

/** Backward-compatible alias for the selected canonical timebase. */
export const CANONICAL_TICKS_PER_SECOND = TICKS_PER_SECOND;

/** Number of canonical ticks represented by one millisecond. */
export const TICKS_PER_MILLISECOND = TICKS_PER_SECOND / 1_000;

/** Largest integer that JavaScript can represent without losing tick precision. */
export const MAX_SAFE_TICKS = Number.MAX_SAFE_INTEGER;

declare const ticksBrand: unique symbol;

/** Integer timeline position or duration expressed in the active tick base. */
export type Ticks = number & { readonly [ticksBrand]: 'Ticks' };

export const STANDARD_AUDIO_SAMPLE_RATES = [
  8_000, 11_025, 16_000, 22_050, 32_000, 44_100, 48_000, 88_200, 96_000, 176_400, 192_000,
] as const;

export interface FrameRate {
  num: number;
  den: number;
}

export interface StandardFrameRate extends FrameRate {
  label: string;
}

export const STANDARD_FRAME_RATES = [
  { label: '23.976', num: 24_000, den: 1_001 },
  { label: '24', num: 24, den: 1 },
  { label: '25', num: 25, den: 1 },
  { label: '29.97', num: 30_000, den: 1_001 },
  { label: '30', num: 30, den: 1 },
  { label: '47.952', num: 48_000, den: 1_001 },
  { label: '48', num: 48, den: 1 },
  { label: '50', num: 50, den: 1 },
  { label: '59.94', num: 60_000, den: 1_001 },
  { label: '60', num: 60, den: 1 },
  { label: '95.904', num: 96_000, den: 1_001 },
  { label: '96', num: 96, den: 1 },
  { label: '100', num: 100, den: 1 },
  { label: '119.88', num: 120_000, den: 1_001 },
  { label: '120', num: 120, den: 1 },
] as const satisfies readonly StandardFrameRate[];

export type QuantizeMode = 'round' | 'floor' | 'ceil';

export const DEFAULT_FRAME_RATE: FrameRate = { num: 30, den: 1 };

export function frameRateToNumber(frameRate: FrameRate): number {
  if (
    !Number.isFinite(frameRate.num) ||
    !Number.isFinite(frameRate.den) ||
    frameRate.num <= 0 ||
    frameRate.den <= 0
  ) {
    return 0;
  }

  return frameRate.num / frameRate.den;
}

export function frameRateToStandardFpsValue(frameRate: StandardFrameRate): number {
  return Number(frameRate.label);
}

export function sanitizeFrameRate(
  value: unknown,
  fallback: FrameRate = DEFAULT_FRAME_RATE,
): FrameRate {
  const parsed = parseFrameRate(value);
  if (!parsed) return { ...fallback };

  const normalized = reduceFrameRate(parsed);
  const fps = frameRateToNumber(normalized);
  if (fps < 1 || fps > 240) return { ...fallback };

  const standard = STANDARD_FRAME_RATES.find(
    (candidate) => Math.abs(frameRateToNumber(candidate) - fps) < 0.001,
  );
  return standard ? { num: standard.num, den: standard.den } : normalized;
}

export function findStandardFrameRate(value: unknown): StandardFrameRate | null {
  const frameRate = sanitizeFrameRate(value);
  return (
    STANDARD_FRAME_RATES.find(
      (candidate) => candidate.num === frameRate.num && candidate.den === frameRate.den,
    ) ?? null
  );
}

export function findNearestStandardFrameRate(value: unknown): StandardFrameRate {
  const parsed = parseFrameRate(value);
  const fps = parsed
    ? frameRateToNumber(reduceFrameRate(parsed))
    : typeof value === 'number' && Number.isFinite(value)
      ? value
      : frameRateToNumber(DEFAULT_FRAME_RATE);

  if (!Number.isFinite(fps) || fps <= 0) {
    const defaultRate = STANDARD_FRAME_RATES.find(
      (candidate) =>
        candidate.num === DEFAULT_FRAME_RATE.num && candidate.den === DEFAULT_FRAME_RATE.den,
    );
    return defaultRate ?? STANDARD_FRAME_RATES[4];
  }

  let nearest = STANDARD_FRAME_RATES[0];
  let minDiff = Math.abs(frameRateToNumber(nearest) - fps);

  for (let i = 1; i < STANDARD_FRAME_RATES.length; i++) {
    const candidate = STANDARD_FRAME_RATES[i];
    const candidateFps = frameRateToNumber(candidate);
    const diff = Math.abs(candidateFps - fps);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = candidate;
    }
  }

  return nearest;
}


export function ticksToSeconds(ticks: number): number {
  return ticks / TICKS_PER_SECOND;
}

export function secondsToTicks(params: { seconds: number; mode?: QuantizeMode }): Ticks {
  return toTicks(roundToMode(params.seconds * TICKS_PER_SECOND, params.mode ?? 'round'));
}

export function ticksToFrames(params: {
  ticks: number;
  frameRate: FrameRate;
  mode?: QuantizeMode;
}): number {
  const frameRate = sanitizeFrameRate(params.frameRate);
  if (!Number.isFinite(params.ticks)) return 0;
  return roundToMode(
    (params.ticks * frameRate.num) / (TICKS_PER_SECOND * frameRate.den),
    params.mode ?? 'round',
  );
}

export function framesToTicks(params: { frames: number; frameRate: FrameRate }): Ticks {
  const frameRate = sanitizeFrameRate(params.frameRate);
  if (!Number.isFinite(params.frames)) return toTicks(0);
  return toTicks(Math.round((params.frames * TICKS_PER_SECOND * frameRate.den) / frameRate.num));
}

export function quantizeTicksToFrame(params: {
  ticks: number;
  frameRate: FrameRate;
  mode?: QuantizeMode;
}): Ticks {
  return framesToTicks({
    frames: ticksToFrames(params),
    frameRate: params.frameRate,
  });
}

export function isTickRateFrameCompatible(params: {
  ticksPerSecond: number;
  frameRate: FrameRate;
}): boolean {
  const { ticksPerSecond } = params;
  const frameRate = sanitizeFrameRate(params.frameRate);
  return (
    Number.isInteger(ticksPerSecond) &&
    ticksPerSecond > 0 &&
    Number.isInteger(frameRate.num) &&
    Number.isInteger(frameRate.den) &&
    frameRate.num > 0 &&
    frameRate.den > 0 &&
    Number.isInteger((ticksPerSecond * frameRate.den) / frameRate.num)
  );
}

export function ticksPerFrame(params: { ticksPerSecond: number; frameRate: FrameRate }): number {
  const { ticksPerSecond, frameRate } = params;
  if (!Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) return 0;
  if (
    !Number.isFinite(frameRate.num) ||
    !Number.isFinite(frameRate.den) ||
    frameRate.num <= 0 ||
    frameRate.den <= 0
  ) {
    return 0;
  }

  return (ticksPerSecond * frameRate.den) / frameRate.num;
}

export function isTickRateSampleCompatible(params: {
  ticksPerSecond: number;
  sampleRate: number;
}): boolean {
  return (
    Number.isInteger(params.ticksPerSecond) &&
    params.ticksPerSecond > 0 &&
    Number.isInteger(params.sampleRate) &&
    params.sampleRate > 0 &&
    params.ticksPerSecond % params.sampleRate === 0
  );
}

export function formatTicksAsTimecode(params: { ticks: number; fps: number }): string {
  const { ticks, fps } = params;
  if (!Number.isFinite(fps) || fps <= 0) return '00:00:00:00';

  const isNegative = ticks < 0;
  const totalFrames = Math.round(Math.abs(ticksToSeconds(ticks)) * fps);
  const ff = Math.floor(totalFrames % fps);
  const totalSeconds = Math.floor(totalFrames / fps);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => String(Math.floor(value)).padStart(2, '0');
  const formatted = `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;

  return isNegative ? `-${formatted}` : formatted;
}

export function parseTimecodeToTicks(params: { timecode: string; fps: number }): Ticks | null {
  const { fps } = params;
  const trimmed = params.timecode.trim();
  if (!trimmed || !Number.isFinite(fps) || fps <= 0) return null;

  const isNegative = trimmed.startsWith('-');
  const clean = trimmed.replace(/^-/, '');
  if (!/^[0-9:]+$/.test(clean)) return null;

  const parts = clean.split(':').map((part) => (part === '' ? 0 : Number(part)));
  if (parts.length > 4) return null;

  const [hh, mm, ss, ff] = [
    parts.length === 4 ? (parts[0] ?? 0) : 0,
    parts.length >= 3 ? (parts[parts.length - 3] ?? 0) : 0,
    parts.length >= 2 ? (parts[parts.length - 2] ?? 0) : (parts[0] ?? 0),
    parts.length >= 2 ? (parts[parts.length - 1] ?? 0) : 0,
  ];
  const totalFrames = (hh * 3600 + mm * 60 + ss) * fps + ff;
  const ticks = toTicks(Math.round((totalFrames / fps) * TICKS_PER_SECOND));

  return isNegative ? toTicks(-ticks) : ticks;
}

function roundToMode(value: number, mode: QuantizeMode): number {
  if (mode === 'floor') return Math.floor(value);
  if (mode === 'ceil') return Math.ceil(value);
  return Math.round(value);
}

function parseFrameRate(value: unknown): FrameRate | null {
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const num = Number(record.num);
    const den = Number(record.den);
    if (Number.isFinite(num) && Number.isFinite(den) && num > 0 && den > 0) {
      return { num: Math.round(num), den: Math.round(den) };
    }

    if ('fps' in record) return parseFrameRate(record.fps);
    return null;
  }

  const fps = Number(value);
  if (!Number.isFinite(fps) || fps <= 0) return null;
  return { num: Math.round(fps * 1_000), den: 1_000 };
}

function reduceFrameRate(frameRate: FrameRate): FrameRate {
  const divisor = greatestCommonDivisor(frameRate.num, frameRate.den);
  return { num: frameRate.num / divisor, den: frameRate.den / divisor };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b > 0) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

function toTicks(value: number): Ticks {
  if (value === Infinity) return MAX_SAFE_TICKS as Ticks;
  if (value === -Infinity) return -MAX_SAFE_TICKS as Ticks;
  if (!Number.isFinite(value)) return 0 as Ticks;
  return Math.max(-MAX_SAFE_TICKS, Math.min(MAX_SAFE_TICKS, Math.round(value))) as Ticks;
}
