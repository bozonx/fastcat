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
