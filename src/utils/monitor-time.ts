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
