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

  it('maps each direction to the correct p0 shader code', () => {
    mockTauriRuntime(true);
    const manifest = getTransitionManifestByType('clock');

    const code = (direction: string) =>
      manifest?.toTransitionSpec?.({ direction, softness: 0 })?.params?.p0;

    expect(code('clockwise')).toBe(1);
    expect(code('counterclockwise')).toBe(-1);
    expect(code('symmetric')).toBe(2);
    expect(code('lineClockwise')).toBe(3);
    expect(code('lineCounterclockwise')).toBe(4);

    restoreTauriRuntime();
  });

  it('keeps the new line directions through normalization', () => {
    const manifest = getTransitionManifestByType('clock');

    expect(manifest?.normalizeParams?.({ direction: 'lineClockwise' })?.direction).toBe(
      'lineClockwise',
    );
    expect(manifest?.normalizeParams?.({ direction: 'lineCounterclockwise' })?.direction).toBe(
      'lineCounterclockwise',
    );
    expect(manifest?.normalizeParams?.({ direction: 'bogus' })?.direction).toBe('clockwise');
  });
});
