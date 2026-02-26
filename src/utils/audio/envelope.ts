export function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  if (min > max) return undefined;
  return Math.max(min, Math.min(max, value));
}

export function normalizeGain(raw: unknown, fallback = 1): number {
  const n = clampNumber(raw, 0, 10);
  const base = typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 1;
  return Math.max(0, Math.min(10, n ?? base));
}

export function normalizeBalance(raw: unknown, fallback = 0): number {
  const n = clampNumber(raw, -1, 1);
  const base = typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 0;
  return Math.max(-1, Math.min(1, n ?? base));
}

export function mergeGain(a: unknown, b: unknown): number | undefined {
  const ga = clampNumber(a, 0, 10);
  const gb = clampNumber(b, 0, 10);
  if (ga === undefined && gb === undefined) return undefined;
  const result = (ga ?? 1) * (gb ?? 1);
  return Math.max(0, Math.min(10, result));
}

export function mergeBalance(a: unknown, b: unknown): number | undefined {
  const ba = clampNumber(a, -1, 1);
  const bb = clampNumber(b, -1, 1);
  if (ba === undefined && bb === undefined) return undefined;
  const result = (ba ?? 0) + (bb ?? 0);
  return Math.max(-1, Math.min(1, result));
}

export interface FadeDurationsSeconds {
  fadeInS: number;
  fadeOutS: number;
}

export function computeFadeDurationsSeconds(params: {
  clipDurationS: number;
  fadeInUs?: unknown;
  fadeOutUs?: unknown;
}): FadeDurationsSeconds {
  const clipDurationS = Number.isFinite(params.clipDurationS)
    ? Math.max(0, params.clipDurationS)
    : 0;

  const fadeInUs = clampNumber(params.fadeInUs, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const fadeOutUs = clampNumber(params.fadeOutUs, 0, Number.MAX_SAFE_INTEGER) ?? 0;

  const rawFadeInS = fadeInUs / 1_000_000;
  const rawFadeOutS = fadeOutUs / 1_000_000;

  const fadeInS = Math.min(clipDurationS, Math.max(0, rawFadeInS));
  const fadeOutS = Math.min(clipDurationS, Math.max(0, rawFadeOutS));

  return { fadeInS, fadeOutS };
}

export function getGainAtClipTime(params: {
  clipDurationS: number;
  fadeInS: number;
  fadeOutS: number;
  baseGain: number;
  tClipS: number;
}): number {
  const clipDurationS = Math.max(0, params.clipDurationS);
  const fadeInS = Math.max(0, Math.min(params.fadeInS, clipDurationS));
  const fadeOutS = Math.max(0, Math.min(params.fadeOutS, clipDurationS));
  const baseGain = Math.max(0, Math.min(10, params.baseGain));

  const t = Math.max(0, Math.min(clipDurationS, params.tClipS));

  let g = baseGain;

  if (fadeInS > 0 && t < fadeInS) {
    g *= t / fadeInS;
  }

  if (fadeOutS > 0 && t > clipDurationS - fadeOutS) {
    const remaining = clipDurationS - t;
    if (remaining <= 0) g = 0;
    else g *= remaining / fadeOutS;
  }

  return Math.max(0, Math.min(10, g));
}
