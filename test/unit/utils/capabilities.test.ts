import { afterEach, describe, expect, it } from 'vitest';
import { getPlatformCapabilities } from '~/utils/capabilities';

type TauriGlobal = { __TAURI_INTERNALS__?: unknown };

function clearTauriGlobal() {
  if (typeof window !== 'undefined') delete (window as TauriGlobal).__TAURI_INTERNALS__;
  delete (globalThis as TauriGlobal).__TAURI_INTERNALS__;
}

describe('getPlatformCapabilities', () => {
  afterEach(() => {
    clearTauriGlobal();
  });

  it('disables all native capabilities in the web runtime', () => {
    clearTauriGlobal();
    expect(getPlatformCapabilities()).toEqual({
      nativeMediaProcessing: false,
      hardwareEncoding: false,
      systemFonts: false,
      nativeAudioEngine: false,
    });
  });

  it('enables all native capabilities inside the Tauri runtime', () => {
    (globalThis as TauriGlobal).__TAURI_INTERNALS__ = {};
    expect(getPlatformCapabilities()).toEqual({
      nativeMediaProcessing: true,
      hardwareEncoding: true,
      systemFonts: true,
      nativeAudioEngine: true,
    });
  });
});
