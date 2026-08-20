import type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';

export interface AudioEngineOptions {
  getVfs?: () => unknown | null;
  getAudioCacheVfsPath?: () => string | null;
}

/**
 * Declares which optional features a concrete audio engine actually supports,
 * so callers can branch instead of relying on silent no-op implementations.
 * The Tauri engine, for example, delegates output to Rust and does not provide
 * Web Audio scrub preview, JS peak extraction, or level metering.
 */
export interface AudioEngineCapabilities {
  /** `previewScrubForward` / `stopScrubPreview` produce audible scrubbing. */
  scrubPreview: boolean;
  /** `extractPeaks` returns waveform peaks (vs. always `null`). */
  peaksExtraction: boolean;
  /** `getLevels` returns live RMS/peak meters (vs. static silence). */
  levelMetering: boolean;
}

export interface IAudioEngine {
  /** Static description of which optional features this engine implements. */
  readonly capabilities: AudioEngineCapabilities;
  init(options?: { sampleRate?: number; audioChannels?: 'stereo' | 'mono' }): Promise<void>;
  loadClips(clips: AudioEngineClip[]): Promise<void>;
  updateTimelineLayout(clips: AudioEngineClip[]): Promise<void>;
  play(timeTicks: number, speed?: number): Promise<void>;
  stop(): void;
  seek(timeTicks: number): void;
  setGlobalSpeed(speed: number): void;
  resumeContext(): Promise<void>;
  setMasterVolume(volume: number): void;
  setMonitorVolume(volume: number): void;
  setMasterAudioEffects(effects: import('~/timeline/types').ClipEffect[]): void;
  getCurrentTimeTicks(): number;
  getLevels(trackId?: string): { rmsDb: number; peakDb: number };
  previewScrubForward(
    fromTicks: number,
    toTicks: number,
    maxPreviewDurationTicks?: number,
  ): Promise<void>;
  stopScrubPreview(): void;
  extractPeaks(
    fileHandle: FileSystemFileHandle,
    sourceKey: string,
    options?: { maxLength?: number; precision?: number; durationS?: number },
  ): Promise<Float32Array[] | null>;
  destroy(): void;
}
