import { TICKS_PER_SECOND } from '~/utils/time';
import type { ImageSource } from 'pixi.js';
import { safeDispose } from '../utils';
import { governedBlobWorker } from '~/utils/io/governed-blob-worker';
import { createPlaceholderImageSource } from './placeholderImageSource';

export interface MediabunnyTrack {
  canDecode(): Promise<boolean>;
  getFirstTimestamp(): Promise<number>;
  computeDuration(): Promise<number>;
  getFrameRate?(): Promise<number>;
  rotation?: unknown;
  frameRate?: number;
  fps?: number;
}

export interface MediaClipLoaderMediabunny {
  Input: new (params: unknown) => { getPrimaryVideoTrack(): Promise<MediabunnyTrack | null> };
  BlobSource: new (file: File) => unknown;
  VideoSampleSink: new (track: unknown) => unknown;
  ALL_FORMATS: unknown;
}

export interface LoadVideoRuntimeParams {
  mediabunny: MediaClipLoaderMediabunny;
  file: File;
  sourceStartUs: number;
  requestedTimelineDurationUs: number;
  requestedSourceDurationUs: number;
  requestedSourceRangeDurationUs: number;
  startUs: number;
  abortSignal?: AbortSignal;
}

export interface LoadedVideoRuntime {
  input: unknown;
  sink: unknown;
  firstTimestampS?: number;
  frameRate?: number;
  sourceDurationUs: number;
  sourceRangeDurationUs: number;
  durationUs: number;
  endUs: number;
  imageSource: ImageSource;
  sourceRotation?: number;
}

export class MediaClipLoader {
  public async loadVideoRuntime(
    params: LoadVideoRuntimeParams,
  ): Promise<LoadedVideoRuntime | null> {
    const {
      mediabunny,
      file,
      sourceStartUs,
      requestedTimelineDurationUs,
      requestedSourceDurationUs,
      requestedSourceRangeDurationUs,
      startUs,
      abortSignal,
    } = params;
    if (abortSignal?.aborted) {
      const abortErr = new Error('Video runtime load was aborted');
      (abortErr as Error).name = 'AbortError';
      throw abortErr;
    }

    const source = new mediabunny.BlobSource(governedBlobWorker(file));
    const input = new mediabunny.Input({
      source,
      formats: mediabunny.ALL_FORMATS,
    });
    try {
      const track = await input.getPrimaryVideoTrack();

      if (abortSignal?.aborted) {
        const abortErr = new Error('Video runtime load was aborted');
        (abortErr as Error).name = 'AbortError';
        throw abortErr;
      }

      if (!track || !(await track.canDecode())) {
        safeDispose(input);
        return null;
      }

      const sink = new mediabunny.VideoSampleSink(track);
      const firstTimestampS = await track.getFirstTimestamp();
      const trackAny = track as {
        getFrameRate?: () => Promise<number>;
        frameRate?: number;
        fps?: number;
        computePacketStats?: (targetPacketCount?: number) => Promise<{ averagePacketRate: number }>;
      };
      let frameRateRaw =
        typeof trackAny.getFrameRate === 'function'
          ? await trackAny.getFrameRate()
          : (trackAny.frameRate ?? trackAny.fps);
      if (!(Number(frameRateRaw) > 0) && typeof trackAny.computePacketStats === 'function') {
        // mediabunny's InputVideoTrack exposes no direct frame-rate accessor; the
        // sanctioned way is packet stats, whose averagePacketRate "will equal the
        // average frame rate (FPS)" for video tracks. A small packet prefix gives a
        // solid estimate without scanning the file. Without this every clip loaded
        // with frameRate: undefined, which made computeFrameIndex fall back to
        // exact-tick cache keys — so the frame cache/prewarm NEVER produced a
        // cross-timestamp hit and playback paid a cold from-keyframe getSample
        // decode per displayed frame (the low-fps web playback bug).
        try {
          frameRateRaw = (await trackAny.computePacketStats(60)).averagePacketRate;
        } catch {
          // keep undefined: exact-tick cache keying still works for repeat renders
        }
      }
      const frameRate = Number(frameRateRaw);
      const sourceRotation = Number((track as { rotation?: unknown }).rotation);
      const mediaDurationUs = Math.max(
        0,
        Math.round((await track.computeDuration()) * TICKS_PER_SECOND),
      );
      const maxSourceTailUs = Math.max(0, mediaDurationUs - sourceStartUs);
      // `sourceDurationUs` is the FULL duration of the source media, in the
      // absolute source-time domain. Consumers rely on that: transition handle
      // math computes `sourceDurationUs - sourceStartUs - sourceRangeDurationUs`
      // (TransitionRenderer / FrameSampleOrchestrator) and uses the value as an
      // absolute PTS cap, and the reuse/layout-update paths store the payload's
      // full-duration value unchanged. Clamping by the tail here subtracted
      // sourceStartUs a second time, so freshly loaded clips trimmed at their
      // start lost exactly that much transition handle (frozen/backward-jumping
      // transition frames) until the first layout update overwrote the value.
      const sourceDurationUs =
        requestedSourceDurationUs > 0
          ? Math.min(requestedSourceDurationUs, mediaDurationUs)
          : mediaDurationUs;
      // The timeline-duration fallback, by contrast, is the playable remainder
      // from the trim-in point — the tail, not the full duration.
      const durationUs =
        requestedTimelineDurationUs > 0 ? requestedTimelineDurationUs : maxSourceTailUs;
      const endUs = startUs + durationUs;

      return {
        input,
        sink,
        firstTimestampS,
        frameRate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : undefined,
        sourceDurationUs,
        sourceRangeDurationUs:
          requestedSourceRangeDurationUs > 0 ? requestedSourceRangeDurationUs : durationUs,
        durationUs,
        endUs,
        imageSource: createPlaceholderImageSource(),
        sourceRotation: Number.isFinite(sourceRotation) ? sourceRotation : undefined,
      };
    } catch (error) {
      safeDispose(input);
      throw error;
    }
  }
}
