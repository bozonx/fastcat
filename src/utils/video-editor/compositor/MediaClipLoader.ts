import { ImageSource } from 'pixi.js';
import { safeDispose } from '../utils';

export interface MediaClipLoaderMediabunny {
  Input: new (params: any) => any;
  BlobSource: new (file: File) => any;
  VideoSampleSink: new (track: any) => any;
  ALL_FORMATS: any;
}

export interface LoadVideoRuntimeParams {
  mediabunny: MediaClipLoaderMediabunny;
  file: File;
  sourceStartUs: number;
  requestedTimelineDurationUs: number;
  requestedSourceDurationUs: number;
  requestedSourceRangeDurationUs: number;
  startUs: number;
}

export interface LoadedVideoRuntime {
  input: any;
  sink: any;
  firstTimestampS?: number;
  frameRate?: number;
  sourceDurationUs: number;
  sourceRangeDurationUs: number;
  durationUs: number;
  endUs: number;
  imageSource: ImageSource;
}

export class MediaClipLoader {
  public async loadVideoRuntime(params: LoadVideoRuntimeParams): Promise<LoadedVideoRuntime | null> {
    const {
      mediabunny,
      file,
      sourceStartUs,
      requestedTimelineDurationUs,
      requestedSourceDurationUs,
      requestedSourceRangeDurationUs,
      startUs,
    } = params;

    const source = new mediabunny.BlobSource(file);
    const input = new mediabunny.Input({
      source,
      formats: mediabunny.ALL_FORMATS,
    } as any);
    const track = await input.getPrimaryVideoTrack();

    if (!track || !(await track.canDecode())) {
      safeDispose(input);
      return null;
    }

    const sink = new mediabunny.VideoSampleSink(track);
    const firstTimestampS = await track.getFirstTimestamp();
    const trackAny = track as any;
    const frameRateRaw =
      typeof trackAny.getFrameRate === 'function'
        ? await trackAny.getFrameRate()
        : (trackAny.frameRate ?? trackAny.fps);
    const frameRate = Number(frameRateRaw);
    const mediaDurationUs = Math.max(0, Math.round((await track.computeDuration()) * 1_000_000));
    const maxSourceTailUs = Math.max(0, mediaDurationUs - sourceStartUs);
    const sourceDurationUs =
      requestedSourceDurationUs > 0
        ? Math.min(requestedSourceDurationUs, maxSourceTailUs)
        : maxSourceTailUs;
    const durationUs = requestedTimelineDurationUs > 0 ? requestedTimelineDurationUs : sourceDurationUs;
    const endUs = startUs + durationUs;

    return {
      input,
      sink,
      firstTimestampS,
      frameRate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : undefined,
      sourceDurationUs,
      sourceRangeDurationUs: requestedSourceRangeDurationUs > 0 ? requestedSourceRangeDurationUs : durationUs,
      durationUs,
      endUs,
      imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }),
    };
  }
}
