import { createDevLogger } from '~/utils/dev-logger';
import { normalizeHexColor, hexToRgbUint } from '~/utils/color';
const log = createDevLogger('utils');
export function safeDispose(resource: unknown): void {
  if (!resource || typeof resource !== 'object') return;
  if ('dispose' in resource && typeof (resource as { dispose?: unknown }).dispose === 'function') {
    try {
      (resource as { dispose: () => void }).dispose();
    } catch (e) {
      log.warn('[safeDispose] Error during dispose:', e);
    }
    return;
  }
  if ('close' in resource && typeof (resource as { close?: unknown }).close === 'function') {
    try {
      (resource as { close: () => void }).close();
    } catch (e) {
      log.warn('[safeDispose] Error during close:', e);
    }
  }
}

export function sanitizeTimelineColor(value: unknown, fallback = '#000000'): string {
  return normalizeHexColor(value, fallback);
}

export function parseHexColor(value: string): number {
  return hexToRgbUint(value, '#000000');
}

/**
 * Checks whether an error indicates a disposed media input.
 * Used across ResourceManager to normalize error handling.
 */
export function isInputDisposed(e: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const name = e instanceof Error ? e.name : ((e as any)?.name ?? '');
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return name === 'InputDisposedError' || msg.includes('Input has been disposed');
}
