/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { wipeManifest } from '~/transitions/wipe/manifest';
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

describe('wipe transition blur parameter', () => {
  it('normalizes web blur to percentage range 0..20', () => {
    const normalized = wipeManifest.normalizeParams?.({ edgeMode: 'blur', blur: 0.5 });

    expect(normalized?.blur).toBe(0.5);
    expect(wipeManifest.normalizeParams?.({ edgeMode: 'blur', blur: -10 })?.blur).toBe(0);
    expect(wipeManifest.normalizeParams?.({ edgeMode: 'blur', blur: 100 })?.blur).toBe(20);
  });

  it('passes web blur percentage to shader as normalized UV value', () => {
    const params = wipeManifest.normalizeParams?.({ edgeMode: 'blur', blur: 5 });

    expect(params?.blur).toBe(5);
    // updateFilter divides by 100 before setting the uniform.
    expect((params?.blur ?? 0) / 100).toBe(0.05);
  });

  it('converts Tauri blur percentage to normalized UV in toTauriSpec', () => {
    mockTauriRuntime(true);
    const manifest = getTauriTransitionManifest('wipe');
    expect(manifest).toBeDefined();

    const spec = manifest?.toTauriSpec?.({
      edgeMode: 'blur',
      blur: 10,
      direction: 'left',
      angle: 0,
      gap: 0,
      gapColor: '#000000',
    });

    expect(spec?.params).toMatchObject({
      p3: 0.1,
    });

    restoreTauriRuntime();
  });

  it('clamps Tauri blur percentage to the renderer range', () => {
    mockTauriRuntime(true);
    const manifest = getTauriTransitionManifest('wipe');

    const tooSmall = manifest?.toTauriSpec?.({
      edgeMode: 'blur',
      blur: 0,
      direction: 'left',
      angle: 0,
      gap: 0,
      gapColor: '#000000',
    });
    expect(tooSmall?.params).toMatchObject({
      p3: 0.0001,
    });

    const tooLarge = manifest?.toTauriSpec?.({
      edgeMode: 'blur',
      blur: 50,
      direction: 'left',
      angle: 0,
      gap: 0,
      gapColor: '#000000',
    });
    expect(tooLarge?.params).toMatchObject({
      p3: 0.2,
    });

    restoreTauriRuntime();
  });
});
