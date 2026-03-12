export function safeDispose(resource: unknown): void {
  if (!resource || typeof resource !== 'object') return;
  if ('dispose' in resource && typeof (resource as { dispose?: unknown }).dispose === 'function') {
    try {
      (resource as { dispose: () => void }).dispose();
    } catch (e) {
      console.warn('[safeDispose] Error during dispose:', e);
    }
    return;
  }
  if ('close' in resource && typeof (resource as { close?: unknown }).close === 'function') {
    try {
      (resource as { close: () => void }).close();
    } catch (e) {
      console.warn('[safeDispose] Error during close:', e);
    }
  }
}

export function parseUsToS(us: number | string | undefined | null, fallback = 0): number {
  if (us == null || isNaN(Number(us))) return fallback;
  return Math.max(0, Number(us) / 1_000_000);
}

export function parseUs(us: number | string | undefined | null, fallback = 0): number {
  if (us == null || isNaN(Number(us))) return fallback;
  return Math.max(0, Math.round(Number(us)));
}

export function sanitizeTimelineColor(value: unknown, fallback = '#000000'): string {
  const raw = String(value ?? '')
    .trim()
    .replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const r = raw[0] ?? '0';
    const g = raw[1] ?? '0';
    const b = raw[2] ?? '0';
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(raw)) {
    return `#${raw}`.toLowerCase();
  }
  return fallback.toLowerCase();
}

export function parseHexColor(value: string): number {
  const hex = sanitizeTimelineColor(value).slice(1);
  const parsed = Number.parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Checks whether an error indicates a disposed media input.
 * Used across ResourceManager to normalize error handling.
 */
export function isInputDisposed(e: unknown): boolean {
  const name = String((e as any)?.name ?? '');
  const msg = String((e as any)?.message ?? e ?? '');
  return name === 'InputDisposedError' || msg.includes('Input has been disposed');
}
