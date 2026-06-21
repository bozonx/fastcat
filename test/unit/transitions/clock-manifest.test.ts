/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { getTransitionManifestByType } from '~/transitions/manifests';
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

describe('clock transition manifest', () => {
  it('normalizes softness parameter with correct defaults', () => {
    const manifest = getTransitionManifestByType('clock');
    expect(manifest).toBeDefined();

    const normalizedDefault = manifest?.normalizeParams?.({});
    expect(normalizedDefault).toMatchObject({
      direction: 'clockwise',
      softness: 0,
    });

    const normalizedCustom = manifest?.normalizeParams?.({
      direction: 'counterclockwise',
      softness: 75,
    });
    expect(normalizedCustom).toMatchObject({
      direction: 'counterclockwise',
      softness: 75,
    });
  });

  it('converts softness percentage to normalized range [0.0001, 0.5] in toTransitionSpec', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('clock');

    const spec0 = manifest?.toTransitionSpec?.({
      direction: 'clockwise',
      softness: 0,
    });
    expect(spec0?.params).toMatchObject({
      p1: 0.0001,
    });

    const spec50 = manifest?.toTransitionSpec?.({
      direction: 'clockwise',
      softness: 50,
    });
    expect(spec50?.params).toMatchObject({
      p1: 0.5,
    });

    const spec100 = manifest?.toTransitionSpec?.({
      direction: 'clockwise',
      softness: 100,
    });
    expect(spec100?.params).toMatchObject({
      p1: 0.5,
    });

    restoreTauriRuntime();
  });
});
