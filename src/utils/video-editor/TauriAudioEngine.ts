import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { createDevLogger } from '~/utils/dev-logger';
import { AudioScheduler } from '~/utils/video-editor/AudioScheduler';
import type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';
import type {
  AudioEngineOptions,
  IAudioEngine,
  AudioEngineCapabilities,
} from './audio-engine.interface';

const logger = createDevLogger('TauriAudioEngine');
const EVT_TIME = 'monitor:time';

/**
 * Tauri-native audio engine that does NOT use the Web Audio API.
 * Playback timing is driven by AudioScheduler running on wall-clock time,
 * while actual audio output is handled by the Rust NativeAudioEngine via
 * IPC (monitor_play / monitor_pause / monitor_seek).
 *
 * This class keeps only the state needed by the frontend: clip layout,
 * current playback position, and volume metadata.
 */
export class TauriAudioEngine implements IAudioEngine {
  // Output, scrubbing, peaks and metering are owned by the Rust native engine,
  // not the Web Audio API, so these JS-side features are intentionally absent.
  readonly capabilities: AudioEngineCapabilities = {
    scrubPreview: false,
    peaksExtraction: false,
    levelMetering: false,
  };
  private readonly scheduler: AudioScheduler;
  private currentClips: AudioEngineClip[] = [];
  private destroyed = false;
  private currentMasterVolume = 1;
  private currentMonitorVolume = 1;
  private unlistenTime: UnlistenFn | null = null;

  constructor(_options: AudioEngineOptions = {}) {
    this.scheduler = new AudioScheduler({
      getContext: () => null,
      onScheduleLookahead: () => {
        // No-op: native Rust handles decoding and scheduling.
      },
      onStopNodes: () => {
        // No-op: native Rust handles stopping.
      },
    });

    // Sync frontend clock with Rust audio engine time.
    void listen<number>(EVT_TIME, (event) => {
      if (event.payload !== undefined && event.payload !== null) {
        this.scheduler.syncTime(Math.round(event.payload * 1_000_000));
      }
    }).then((unlisten) => {
      this.unlistenTime = unlisten;
    });
  }

  async init(_options?: { sampleRate?: number; audioChannels?: 'stereo' | 'mono' }) {
    // No Web Audio context to initialize.
  }

  async loadClips(clips: AudioEngineClip[]) {
    this.currentClips = clips;
  }

  async updateTimelineLayout(clips: AudioEngineClip[]) {
    this.currentClips = clips;
  }

  async play(timeUs: number, speed = 1) {
    this.scheduler.play(timeUs, speed);
  }

  stop() {
    this.scheduler.stop();
  }

  seek(timeUs: number) {
    this.scheduler.seek(timeUs);
  }

  setGlobalSpeed(speed: number) {
    this.scheduler.setGlobalSpeed(speed);
  }

  async resumeContext() {
    // No-op: there is no Web Audio context in Tauri native mode.
  }

  setMasterVolume(volume: number) {
    this.currentMasterVolume = Math.max(0, Math.min(10, volume));
    // Native volume is handled by Rust; this is only for frontend state.
  }

  setMonitorVolume(volume: number) {
    this.currentMonitorVolume = Math.max(0, Math.min(10, volume));
  }

  getCurrentTimeUs(): number {
    return this.scheduler.getCurrentTimeUs();
  }

  getLevels(_trackId?: string): { rmsDb: number; peakDb: number } {
    // Native levels could be plumbed from Rust in the future.
    return { rmsDb: -60, peakDb: -60 };
  }

  async previewScrubForward(
    _fromUs: number,
    _toUs: number,
    _maxPreviewDurationUs = 90_000,
  ): Promise<void> {
    // Scrub preview is not implemented in Tauri native mode.
    logger.debug('previewScrubForward is a no-op in Tauri mode');
  }

  stopScrubPreview() {
    // No-op in Tauri mode.
  }

  async extractPeaks(
    _fileHandle: FileSystemFileHandle,
    _sourceKey: string,
    _options?: { maxLength?: number; precision?: number },
  ): Promise<Float32Array[] | null> {
    // Peaks extraction is handled by the media store / native pipeline in Tauri.
    return null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scheduler.destroy();
    if (this.unlistenTime) {
      this.unlistenTime();
      this.unlistenTime = null;
    }
  }
}
