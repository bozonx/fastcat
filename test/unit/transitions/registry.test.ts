/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { initTransitions, normalizeTransitionParams } from '~/transitions';
import { isTauriRuntime } from '~/utils/runtime';

const originalTauriRuntime = isTauriRuntime();

function mockTauriRuntime(value: boolean) {
  (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = value
    ? {}
    : undefined;
}

function restoreTauriRuntime() {
  mockTauriRuntime(originalTauriRuntime);
}

describe('normalizeTransitionParams fallback logic', () => {
  initTransitions();

  it('preserves compatible parameters and resets incompatible/unrelated parameters in web runtime', () => {
    mockTauriRuntime(false);

    // Switching to 'wipe' from a state with direction 'right' (compatible) and zoomMode 'fixed' (unrelated/incompatible)
    const normalized = normalizeTransitionParams('wipe', {
      direction: 'right',
      zoomMode: 'fixed',
      gap: 0.12,
    });

    expect(normalized).toEqual({
      direction: 'right',
      edgeMode: 'gap',
      gap: 0.12,
      gapColor: '#000000',
      blur: 2,
      angle: 0,
    });

    // Switching to 'wipe' with incompatible direction 'to-center' (should reset to default 'left')
    const normalizedReset = normalizeTransitionParams('wipe', {
      direction: 'to-center',
      gap: 0.05,
    });

    expect(normalizedReset).toEqual({
      direction: 'left',
      edgeMode: 'gap',
      gap: 0.05,
      gapColor: '#000000',
      blur: 2,
      angle: 0,
    });

    restoreTauriRuntime();
  });

  it('preserves compatible parameters and resets incompatible/unrelated parameters in Tauri runtime (using fallback)', () => {
    mockTauriRuntime(true);

    // Switching to 'wipe' from a state with direction 'right' (compatible) and zoomMode 'fixed' (unrelated/incompatible)
    const normalized = normalizeTransitionParams('wipe', {
      direction: 'right',
      zoomMode: 'fixed',
      gap: 0.12,
    });

    expect(normalized).toEqual({
      direction: 'right',
      edgeMode: 'gap',
      gap: 0.12,
      gapColor: '#000000',
      blur: 2,
      angle: 0,
    });

    // Switching to 'wipe' with incompatible direction 'to-center' (should reset to default 'left')
    const normalizedReset = normalizeTransitionParams('wipe', {
      direction: 'to-center',
      gap: 0.05,
    });

    expect(normalizedReset).toEqual({
      direction: 'left',
      edgeMode: 'gap',
      gap: 0.05,
      gapColor: '#000000',
      blur: 2,
      angle: 0,
    });

    restoreTauriRuntime();
  });
});
