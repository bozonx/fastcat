import { isTauriRuntime } from '~/utils/runtime';

/**
 * Feature capabilities of the current runtime.
 *
 * Prefer these semantic flags over raw `isTauriRuntime()` checks in UI/feature
 * code: they document *why* a branch exists (which feature is gated) rather
 * than *where* it runs, keep the web/desktop fork in one place, and stay
 * trivially stubbable in tests. Pure runtime quirks (e.g. webview device-pixel
 * ratio caps, fullscreen teleport workarounds) intentionally stay as direct
 * runtime checks — they describe rendering behaviour, not a feature.
 */
export interface PlatformCapabilities {
  /** Native (ffmpeg) media processing: frame extraction, export, proxies, conversion. */
  nativeMediaProcessing: boolean;
  /** Hardware-accelerated encoding and configurable ffmpeg/ffprobe paths. */
  hardwareEncoding: boolean;
  /** OS font enumeration to populate the font picker with installed families. */
  systemFonts: boolean;
  /** Native audio monitor/engine driven over IPC. */
  nativeAudioEngine: boolean;
  /** Native audio plugin discovery/hosting. Desktop-only by design. */
  nativeAudioPlugins: boolean;
}

/**
 * Resolves the capabilities for the active runtime.
 *
 * All native capabilities currently require the Tauri desktop shell. Centralising
 * the mapping here means a future web capability (e.g. WebCodecs hardware
 * encoding) only needs to flip one flag instead of auditing every call site.
 */
export function getPlatformCapabilities(): PlatformCapabilities {
  const native = isTauriRuntime();
  return {
    nativeMediaProcessing: native,
    hardwareEncoding: native,
    systemFonts: native,
    nativeAudioEngine: native,
    nativeAudioPlugins: native,
  };
}
