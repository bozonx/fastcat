const FALLBACK_FPS = 30;
const MIN_FPS = 1;
const MAX_FPS = 240;

export function normalizeTimeUs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.round(value);
}

export function clampTimeUs(value: number, maxDurationUs: number): number {
  const normalizedValue = normalizeTimeUs(value);
  const normalizedMax = normalizeTimeUs(maxDurationUs);

  if (normalizedValue <= 0) {
    return 0;
  }

  if (normalizedMax <= 0) {
    return normalizedValue;
  }

  if (normalizedValue >= normalizedMax) {
    return normalizedMax;
  }

  return normalizedValue;
}

export function sanitizeFps(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return FALLBACK_FPS;
  }

  const rounded = Math.round(parsed);
  if (rounded < MIN_FPS) {
    return MIN_FPS;
  }

  if (rounded > MAX_FPS) {
    return MAX_FPS;
  }

  return rounded;
}
