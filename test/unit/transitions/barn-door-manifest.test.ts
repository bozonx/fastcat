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

describe('barn-door transition blur parameter', () => {
  it('converts shared blur percentage to normalized UV in toTransitionSpec', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('barn-door');
    expect(manifest).toBeDefined();

    const spec = manifest?.toTransitionSpec?.({
      mode: 'open',
      edgeMode: 'blur',
      blur: 10,
      angle: 0,
      gap: 0,
      gapColor: '#000000',
      blurMode: 'fixed',
    });

    expect(spec?.params).toMatchObject({
      p3: 0.1,
    });

    restoreTauriRuntime();
  });

  it('clamps shared blur percentage to the renderer range', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('barn-door');

    const tooSmall = manifest?.toTransitionSpec?.({
      mode: 'open',
      edgeMode: 'blur',
      blur: 0,
      angle: 0,
      gap: 0,
      gapColor: '#000000',
      blurMode: 'fixed',
    });
    expect(tooSmall?.params).toMatchObject({
      p3: 0.0001,
    });

    const tooLarge = manifest?.toTransitionSpec?.({
      mode: 'open',
      edgeMode: 'blur',
      blur: 50,
      angle: 0,
      gap: 0,
      gapColor: '#000000',
      blurMode: 'fixed',
    });
    expect(tooLarge?.params).toMatchObject({
      p3: 0.2,
    });

    restoreTauriRuntime();
  });
});
