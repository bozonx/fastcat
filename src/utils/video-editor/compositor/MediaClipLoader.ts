import { ImageSource } from 'pixi.js';
import { safeDispose } from '../utils';

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

    const source = new mediabunny.BlobSource(file);
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
      };
      const frameRateRaw =
        typeof trackAny.getFrameRate === 'function'
          ? await trackAny.getFrameRate()
          : (trackAny.frameRate ?? trackAny.fps);
      const frameRate = Number(frameRateRaw);
      const sourceRotation = Number((track as { rotation?: unknown }).rotation);
      const mediaDurationUs = Math.max(0, Math.round((await track.computeDuration()) * 1_000_000));
      const maxSourceTailUs = Math.max(0, mediaDurationUs - sourceStartUs);
      const sourceDurationUs =
        requestedSourceDurationUs > 0
          ? Math.min(requestedSourceDurationUs, maxSourceTailUs)
          : maxSourceTailUs;
      const durationUs =
        requestedTimelineDurationUs > 0 ? requestedTimelineDurationUs : sourceDurationUs;
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
        imageSource: new ImageSource({
          resource: new OffscreenCanvas(2, 2) as unknown as HTMLCanvasElement,
        }),
        sourceRotation: Number.isFinite(sourceRotation) ? sourceRotation : undefined,
      };
    } catch (error) {
      safeDispose(input);
      throw error;
    }
  }
}
