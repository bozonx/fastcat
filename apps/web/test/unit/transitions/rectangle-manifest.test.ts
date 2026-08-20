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

describe('rectangle transition blur parameter', () => {
  it('converts shared blur percentage to normalized UV in toTransitionSpec', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('rectangle');
    expect(manifest).toBeDefined();

    const spec = manifest?.toTransitionSpec?.({
      blur: 10,
      blurMode: 'fixed',
      direction: 'from-center',
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
      contentMode: 'reveal',
    });

    expect(spec?.params).toMatchObject({
      p0: 0.1,
    });

    restoreTauriRuntime();
  });

  it('clamps shared blur percentage to the renderer range', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('rectangle');

    const tooSmall = manifest?.toTransitionSpec?.({
      blur: 0,
      blurMode: 'fixed',
      direction: 'from-center',
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
      contentMode: 'reveal',
    });
    expect(tooSmall?.params).toMatchObject({
      p0: 0.0001,
    });

    const tooLarge = manifest?.toTransitionSpec?.({
      blur: 50,
      blurMode: 'fixed',
      direction: 'from-center',
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
      contentMode: 'reveal',
    });
    expect(tooLarge?.params).toMatchObject({
      p0: 0.2,
    });

    restoreTauriRuntime();
  });
});
