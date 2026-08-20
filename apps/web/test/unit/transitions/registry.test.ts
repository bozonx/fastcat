/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import {
  getAllTransitionManifests,
  getTransitionManifest,
  initTransitions,
  normalizeTransitionParams,
} from '~/transitions';

function mockTauriRuntime(value: boolean) {
  (globalThis as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = value
    ? {}
    : undefined;
}

describe('shared transition registry', () => {
  initTransitions();

  it('returns the same built-in manifests in web and Tauri runtimes', () => {
    mockTauriRuntime(false);
    const webManifest = getTransitionManifest('wipe');
    const webTypes = getAllTransitionManifests().map((manifest) => manifest.type);

    mockTauriRuntime(true);
    const tauriManifest = getTransitionManifest('wipe');
    const tauriTypes = getAllTransitionManifests().map((manifest) => manifest.type);

    expect(tauriManifest).toBe(webManifest);
    expect(tauriTypes).toEqual(webTypes);
  });

  it('preserves compatible parameters and resets incompatible or unrelated parameters', () => {
    expect(
      normalizeTransitionParams('wipe', {
        direction: 'right',
        zoomMode: 'fixed',
        gap: 0.12,
      }),
    ).toEqual({
      direction: 'right',
      edgeMode: 'gap',
      gap: 0.12,
      gapColor: '#000000',
      blur: 2,
      angle: 0,
    });

    expect(
      normalizeTransitionParams('wipe', {
        direction: 'to-center',
        gap: 0.05,
      }),
    ).toEqual({
      direction: 'left',
      edgeMode: 'gap',
      gap: 0.05,
      gapColor: '#000000',
      blur: 2,
      angle: 0,
    });
  });
});
