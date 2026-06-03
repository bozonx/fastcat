import type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';

export interface AudioEngineOptions {
  getVfs?: () => unknown | null;
  getAudioCacheVfsPath?: () => string | null;
}

export interface IAudioEngine {
  init(options?: { sampleRate?: number; audioChannels?: 'stereo' | 'mono' }): Promise<void>;
  loadClips(clips: AudioEngineClip[]): Promise<void>;
  updateTimelineLayout(clips: AudioEngineClip[]): Promise<void>;
  play(timeUs: number, speed?: number): Promise<void>;
  stop(): void;
  seek(timeUs: number): void;
  setGlobalSpeed(speed: number): void;
  resumeContext(): Promise<void>;
  setMasterVolume(volume: number): void;
  setMonitorVolume(volume: number): void;
  getCurrentTimeUs(): number;
  getLevels(trackId?: string): { rmsDb: number; peakDb: number };
  previewScrubForward(
    fromUs: number,
    toUs: number,
    maxPreviewDurationUs?: number,
  ): Promise<void>;
  stopScrubPreview(): void;
  extractPeaks(
    fileHandle: FileSystemFileHandle,
    sourceKey: string,
    options?: { maxLength?: number; precision?: number },
  ): Promise<Float32Array[] | null>;
  destroy(): void;
}
