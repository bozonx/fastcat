/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { circleManifest } from '~/transitions/circle/manifest';
import { getTauriTransitionManifest } from '~/transitions/tauri/manifests';
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

describe('circle transition blur parameter', () => {
  it('normalizes web blur to percentage range 0..20', () => {
    const normalized = circleManifest.normalizeParams?.({ blur: 0.5 });

    expect(normalized?.blur).toBe(0.5);
    expect(circleManifest.normalizeParams?.({ blur: -10 })?.blur).toBe(0);
    expect(circleManifest.normalizeParams?.({ blur: 100 })?.blur).toBe(20);
  });

  it('passes web blur percentage to shader as normalized UV value', () => {
    const params = circleManifest.normalizeParams?.({ blur: 5 });

    expect(params?.blur).toBe(5);
    // updateFilter divides by 100 before setting the uniform.
    expect((params?.blur ?? 0) / 100).toBe(0.05);
  });

  it('converts Tauri blur percentage to normalized UV in toTauriSpec', () => {
    mockTauriRuntime(true);
    const manifest = getTauriTransitionManifest('circle');
    expect(manifest).toBeDefined();

    const spec = manifest?.toTauriSpec?.({
      blur: 10,
      blurMode: 'fixed',
      direction: 'from-center',
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
      scaleX: 100,
      scaleY: 100,
      followScale: false,
    });

    expect(spec?.params).toMatchObject({
      p0: 0.1,
    });

    restoreTauriRuntime();
  });

  it('clamps Tauri blur percentage to the renderer range', () => {
    mockTauriRuntime(true);
    const manifest = getTauriTransitionManifest('circle');

    const tooSmall = manifest?.toTauriSpec?.({
      blur: 0,
      blurMode: 'fixed',
      direction: 'from-center',
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
      scaleX: 100,
      scaleY: 100,
      followScale: false,
    });
    expect(tooSmall?.params).toMatchObject({
      p0: 0.0001,
    });

    const tooLarge = manifest?.toTauriSpec?.({
      blur: 50,
      blurMode: 'fixed',
      direction: 'from-center',
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
      scaleX: 100,
      scaleY: 100,
      followScale: false,
    });
    expect(tooLarge?.params).toMatchObject({
      p0: 0.2,
    });

    restoreTauriRuntime();
  });
});
