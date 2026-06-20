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

describe('cube transition parameters in Tauri spec', () => {
  it('converts zoomMode fixed to p2 = 0', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('cube');
    expect(manifest).toBeDefined();

    const spec = manifest?.toTransitionSpec?.({
      direction: 'left',
      zoomMode: 'fixed',
      perspective: 0.7,
      gapSize: 0,
    });

    expect(spec?.params).toMatchObject({
      p2: 0,
    });

    restoreTauriRuntime();
  });

  it('converts zoomMode unzoom to p2 = 1', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('cube');
    expect(manifest).toBeDefined();

    const spec = manifest?.toTransitionSpec?.({
      direction: 'left',
      zoomMode: 'unzoom',
      perspective: 0.7,
      gapSize: 0,
    });

    expect(spec?.params).toMatchObject({
      p2: 1,
    });

    restoreTauriRuntime();
  });

  it('defaults to p2 = 1 when zoomMode is missing or invalid', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('cube');
    expect(manifest).toBeDefined();

    const spec = manifest?.toTransitionSpec?.({
      direction: 'left',
    });

    expect(spec?.params).toMatchObject({
      p2: 1,
    });

    restoreTauriRuntime();
  });

  it('normalizes params correctly via normalizeParams', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('cube');
    expect(manifest).toBeDefined();
    expect(manifest?.normalizeParams).toBeTypeOf('function');

    const norm1 = manifest?.normalizeParams?.({
      zoomMode: 'fixed',
      direction: 'right',
      perspective: 'invalid', // should be fallback
    });

    expect(norm1).toEqual({
      direction: 'right',
      zoomMode: 'fixed',
      perspective: 0.7,
      gapSize: 0,
    });

    const norm2 = manifest?.normalizeParams?.({});
    expect(norm2).toEqual({
      direction: 'left',
      zoomMode: 'unzoom',
      perspective: 0.7,
      gapSize: 0,
    });

    restoreTauriRuntime();
  });
});
