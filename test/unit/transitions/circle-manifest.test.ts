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

describe('circle transition blur parameter', () => {
  it('converts shared blur percentage to normalized UV in toTransitionSpec', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('circle');
    expect(manifest).toBeDefined();

    const spec = manifest?.toTransitionSpec?.({
      blur: 10,
      blurMode: 'fixed',
      direction: 'from-center',
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
      scaleX: 100,
      scaleY: 100,
      contentMode: 'reveal',
    });

    expect(spec?.params).toMatchObject({
      p0: 0.1,
    });

    restoreTauriRuntime();
  });

  it('clamps shared blur percentage to the renderer range', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('circle');

    const tooSmall = manifest?.toTransitionSpec?.({
      blur: 0,
      blurMode: 'fixed',
      direction: 'from-center',
      anchor: 'center',
      offsetX: 0,
      offsetY: 0,
      scaleX: 100,
      scaleY: 100,
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
      scaleX: 100,
      scaleY: 100,
      contentMode: 'reveal',
    });
    expect(tooLarge?.params).toMatchObject({
      p0: 0.2,
    });

    restoreTauriRuntime();
  });

  it('normalizes invalid direction inherited from another transition back to from-center', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('circle');
    expect(manifest).toBeDefined();

    const normalized = manifest?.normalizeParams?.({
      direction: 'symmetric',
      blur: 5,
      blurMode: 'scaled',
      anchor: 'top-left',
      offsetX: 200,
      scaleX: 2000,
    });

    expect(normalized?.direction).toBe('from-center');
    expect(normalized?.blur).toBe(5);
    expect(normalized?.blurMode).toBe('scaled');
    expect(normalized?.anchor).toBe('top-left');
    expect(normalized?.offsetX).toBe(100);
    expect(normalized?.scaleX).toBe(1000);
    expect(normalized?.scaleY).toBe(100);
    expect(normalized?.contentMode).toBe('reveal');

    restoreTauriRuntime();
  });

  it('normalizes Tauri clock direction to a valid value', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('clock');
    expect(manifest).toBeDefined();

    expect(manifest?.normalizeParams?.({ direction: 'left' })?.direction).toBe('clockwise');
    expect(manifest?.normalizeParams?.({ direction: 'symmetric' })?.direction).toBe('symmetric');

    restoreTauriRuntime();
  });

  it('normalizes Tauri rectangle parameters inherited from another transition', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('rectangle');
    expect(manifest).toBeDefined();

    const normalized = manifest?.normalizeParams?.({
      direction: 'symmetric',
      blur: 1,
      blurMode: 'scaled',
      anchor: 'invalid',
      offsetX: 200,
      contentMode: 'invalid',
    });

    expect(normalized?.direction).toBe('from-center');
    expect(normalized?.blur).toBe(1);
    expect(normalized?.blurMode).toBe('scaled');
    expect(normalized?.anchor).toBe('center');
    expect(normalized?.offsetX).toBe(100);
    expect(normalized?.contentMode).toBe('reveal');

    restoreTauriRuntime();
  });
});
