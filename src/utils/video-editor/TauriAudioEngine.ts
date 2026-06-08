import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { nativeMonitorIpc } from '~/composables/monitor/native-monitor-ipc';
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
  // not the Web Audio API. Forward-scrub preview is plumbed through to the native
  // engine (monitor_scrub_preview); peaks/metering remain native-side concerns.
  readonly capabilities: AudioEngineCapabilities = {
    scrubPreview: true,
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
    fromUs: number,
    toUs: number,
    maxPreviewDurationUs = 90_000,
  ): Promise<void> {
    // Play a one-shot audio snippet at the scrub position via the native engine.
    // The native side mixes [from, from+dur) once and plays it out without moving
    // the transport (see NativeAudioEngine::scrub_preview). Reverse scrubbing
    // (toUs <= fromUs) stays silent — only forward scrub previews audio.
    const spanUs = toUs - fromUs;
    if (spanUs <= 0) return;
    const durationSec = Math.min(spanUs, maxPreviewDurationUs) / 1_000_000;
    if (durationSec <= 0) return;
    try {
      await nativeMonitorIpc.scrubPreview(fromUs / 1_000_000, durationSec);
    } catch (error) {
      logger.debug('previewScrubForward failed', error);
    }
  }

  stopScrubPreview() {
    void nativeMonitorIpc.stopScrubPreview().catch((error) => {
      logger.debug('stopScrubPreview failed', error);
    });
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
