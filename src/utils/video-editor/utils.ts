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

export function parseHexColor(value: string): number {
  const raw = String(value ?? '').trim();
  const hex = raw.startsWith('#') ? raw.slice(1) : raw;
  if (hex.length === 3) {
    const r = hex[0] ?? '0';
    const g = hex[1] ?? '0';
    const b = hex[2] ?? '0';
    const expanded = `${r}${r}${g}${g}${b}${b}`;
    const parsed = Number.parseInt(expanded, 16);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number.parseInt(hex.padStart(6, '0').slice(0, 6), 16);
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
