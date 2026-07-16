import { secondsToTicks, TICKS_PER_SECOND, ticksToSeconds } from '~/utils/time';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { MONITOR_EVENTS, nativeMonitorIpc } from '~/composables/monitor/native-monitor-ipc';
import { createDevLogger } from '~/utils/dev-logger';
import { AudioScheduler } from '~/utils/video-editor/AudioScheduler';
import { clampGain } from '~/utils/audio/clamp';
import type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';
import type {
  AudioEngineOptions,
  IAudioEngine,
  AudioEngineCapabilities,
} from './audio-engine.interface';

const logger = createDevLogger('TauriAudioEngine');
const EVT_TIME = 'monitor:time';

export interface NativeAudioLevelsPayload {
  rmsDb: number;
  peakDb: number;
  tracks?: Record<string, { rmsDb: number; peakDb: number }>;
}

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
    levelMetering: true,
  };
  private readonly scheduler: AudioScheduler;
  private currentClips: AudioEngineClip[] = [];
  private destroyed = false;
  private currentMasterVolume = 1;
  private currentMonitorVolume = 1;
  private currentMasterLevels = { rmsDb: -60, peakDb: -60 };
  private currentTrackLevels = new Map<string, { rmsDb: number; peakDb: number }>();
  private unlistenTime: UnlistenFn | null = null;
  private unlistenLevels: UnlistenFn | null = null;

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
      if (this.destroyed) return;
      if (event.payload !== undefined && event.payload !== null) {
        this.scheduler.syncTime(secondsToTicks({ seconds: event.payload }));
      }
    }).then((unlisten) => {
      if (this.destroyed) {
        unlisten();
        return;
      }
      this.unlistenTime = unlisten;
    });

    void listen<NativeAudioLevelsPayload>(MONITOR_EVENTS.audioLevels, (event) => {
      if (this.destroyed) return;
      const levels = event.payload;
      if (!levels) return;
      this.currentMasterLevels = {
        rmsDb: Number.isFinite(levels.rmsDb) ? levels.rmsDb : -60,
        peakDb: Number.isFinite(levels.peakDb) ? levels.peakDb : -60,
      };

      this.currentTrackLevels.clear();
      if (levels.tracks) {
        for (const [trackId, trackLevels] of Object.entries(levels.tracks)) {
          this.currentTrackLevels.set(trackId, {
            rmsDb: Number.isFinite(trackLevels.rmsDb) ? trackLevels.rmsDb : -60,
            peakDb: Number.isFinite(trackLevels.peakDb) ? trackLevels.peakDb : -60,
          });
        }
      }
    }).then((unlisten) => {
      if (this.destroyed) {
        unlisten();
        return;
      }
      this.unlistenLevels = unlisten;
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

  async play(timeTicks: number, speed = 1) {
    await this.scheduler.play(timeTicks, speed);
  }

  stop() {
    this.scheduler.stop();
  }

  seek(timeTicks: number) {
    this.scheduler.seek(timeTicks);
  }

  setGlobalSpeed(speed: number) {
    this.scheduler.setGlobalSpeed(speed);
  }

  async resumeContext() {
    // No-op: there is no Web Audio context in Tauri native mode.
  }

  setMasterVolume(volume: number) {
    this.currentMasterVolume = clampGain(volume);
    void nativeMonitorIpc.setMasterGain(this.currentMasterVolume).catch((error) => {
      logger.warn('Failed to set native master gain', error);
    });
  }

  setMonitorVolume(volume: number) {
    this.currentMonitorVolume = clampGain(volume);
    void nativeMonitorIpc.setOutputGain(this.currentMonitorVolume).catch((error) => {
      logger.debug('setMonitorVolume failed', error);
    });
  }

  setMasterAudioEffects(_effects: import('~/timeline/types').ClipEffect[]) {
    // Native audio master effects are handled by the Rust engine via the scene DTO.
  }

  getCurrentTimeTicks(): number {
    return this.scheduler.getCurrentTimeTicks();
  }

  getLevels(trackId?: string): { rmsDb: number; peakDb: number } {
    // Match WebAudioEngine: meters fall to silence when not actively playing
    // instead of holding the last value pushed from the native engine. Without
    // this the native meters would freeze at their last level on pause/stop.
    if (!this.scheduler.isPlayingActive()) {
      return { rmsDb: -60, peakDb: -60 };
    }
    if (trackId) {
      return this.currentTrackLevels.get(trackId) ?? { rmsDb: -60, peakDb: -60 };
    }
    return this.currentMasterLevels;
  }

  async previewScrubForward(
    fromTicks: number,
    toTicks: number,
    maxPreviewDurationTicks = (TICKS_PER_SECOND * 9) / 100,
  ): Promise<void> {
    // Play a one-shot audio snippet at the scrub position via the native engine.
    // The native side mixes [from, from+dur) once and plays it out without moving
    // the transport (see NativeAudioEngine::scrub_preview). Reverse scrubbing
    // (toTicks <= fromTicks) stays silent — only forward scrub previews audio.
    const spanTicks = toTicks - fromTicks;
    if (spanTicks <= 0) return;
    const durationSec = ticksToSeconds(Math.min(spanTicks, maxPreviewDurationTicks));
    if (durationSec <= 0) return;
    try {
      await nativeMonitorIpc.scrubPreview(ticksToSeconds(fromTicks), durationSec);
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
    _options?: { maxLength?: number; precision?: number; durationS?: number },
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
    if (this.unlistenLevels) {
      this.unlistenLevels();
      this.unlistenLevels = null;
    }
  }
}
