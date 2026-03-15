import { ImageSource } from 'pixi.js';
import { getMediaTypeFromFilename } from '../../media-types';
import type { WorkerTimelineClip } from '../../../composables/monitor/types';
import type { VideoClipEffect } from '~/timeline/types';
import type { MediaClipLoader, MediaClipLoaderMediabunny } from './MediaClipLoader';
import type { RasterImageLoader } from './RasterImageLoader';
import type { TimelineClipDescriptor, TimelineClipLoader } from './TimelineClipLoader';
import type { TimelineFixedClipBuilder } from './TimelineFixedClipBuilder';
import type { TimelineMediaClipBuilder } from './TimelineMediaClipBuilder';
import type { CompositorClip, CompositorTrack } from './types';

export interface TimelineLoadOrchestratorDeps {
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath?: (path: string) => Promise<File | null>;
  getCurrentProjectId?: () => Promise<string | null>;
  ensureVectorImageRaster?: (params: {
    projectId: string;
    projectRelativePath: string;
    width: number;
    height: number;
    sourceFileHandle: FileSystemFileHandle;
  }) => Promise<FileSystemFileHandle | null>;
}

export interface TimelineLoadOrchestratorContext {
  timelineClipLoader: TimelineClipLoader;
  timelineFixedClipBuilder: TimelineFixedClipBuilder;
  timelineMediaClipBuilder: TimelineMediaClipBuilder;
  mediaClipLoader: MediaClipLoader;
  rasterImageLoader: RasterImageLoader;
}

export interface TimelineLoadOrchestratorCallbacks {
  checkCancel?: () => boolean;
  destroyClip: (clip: CompositorClip) => void;
  getExistingClipById: (itemId: string) => CompositorClip | undefined;
  getFallbackTrackId: (clipData: any) => string | null;
  getTrackRuntimeForClip: (clip: Pick<CompositorClip, 'trackId' | 'layer'>) => CompositorTrack | null;
  applySolidLayout: (clip: CompositorClip) => void;
  replaceExistingClip: (params: { reusable: CompositorClip | undefined; itemId: string }) => void;
  resolveFixedClipEnd: (params: {
    startUs: number;
    requestedTimelineDurationUs: number;
    sequentialTimeUs: number;
  }) => {
    endUs: number;
    sequentialTimeUs: number;
  };
  registerLoadedClip: (params: {
    clip: CompositorClip;
    nextClips: CompositorClip[];
    nextClipById: Map<string, CompositorClip>;
  }) => void;
  toVideoEffects: (value: unknown) => VideoClipEffect[] | undefined;
}

export interface TimelineLoadOrchestratorParams {
  timelineClips: (WorkerTimelineClip | { kind: 'meta' | 'track'; [key: string]: any })[];
  deps: TimelineLoadOrchestratorDeps;
  mediabunny: MediaClipLoaderMediabunny;
  callbacks: TimelineLoadOrchestratorCallbacks;
}

export interface TimelineLoadOrchestratorResult {
  nextClips: CompositorClip[];
  nextClipById: Map<string, CompositorClip>;
  sequentialTimeUs: number;
}

export class TimelineLoadOrchestrator {
  constructor(private readonly context: TimelineLoadOrchestratorContext) {}

  public async load(params: TimelineLoadOrchestratorParams): Promise<TimelineLoadOrchestratorResult> {
    const { timelineClips, deps, mediabunny, callbacks } = params;
    const nextClips: CompositorClip[] = [];
    const nextClipById = new Map<string, CompositorClip>();
    let sequentialTimeUs = 0;

    for (const [index, clipData] of timelineClips.entries()) {
      if (callbacks.checkCancel?.()) {
        for (const clip of nextClips) {
          if (!callbacks.getExistingClipById(clip.itemId)) {
            callbacks.destroyClip(clip);
          }
        }
        const abortErr = new Error('Export was cancelled during timeline load');
        (abortErr as any).name = 'AbortError';
        throw abortErr;
      }

      const descriptor = this.context.timelineClipLoader.describe({
        index,
        clipData,
        sequentialTimeUs,
        fallbackTrackId: callbacks.getFallbackTrackId(clipData),
      });
      if (!descriptor) {
        continue;
      }

      const processed = await this.processDescriptor({
        descriptor,
        clipData,
        deps,
        mediabunny,
        callbacks,
        nextClips,
        nextClipById,
        sequentialTimeUs,
      });
      sequentialTimeUs = processed.sequentialTimeUs;
    }

    return {
      nextClips,
      nextClipById,
      sequentialTimeUs,
    };
  }

  private async processDescriptor(params: {
    descriptor: TimelineClipDescriptor;
    clipData: any;
    deps: TimelineLoadOrchestratorDeps;
    mediabunny: MediaClipLoaderMediabunny;
    callbacks: TimelineLoadOrchestratorCallbacks;
    nextClips: CompositorClip[];
    nextClipById: Map<string, CompositorClip>;
    sequentialTimeUs: number;
  }): Promise<{ sequentialTimeUs: number }> {
    const { descriptor, clipData, deps, mediabunny, callbacks, nextClips, nextClipById } = params;
    let { sequentialTimeUs } = params;
    const {
      clipType,
      itemId,
      sourcePath,
      sourceStartUs,
      freezeFrameSourceUs,
      layer,
      trackId,
      requestedTimelineDurationUs,
      requestedSourceRangeDurationUs,
      requestedSourceDurationUs,
      speed,
      startUs,
      endUsFallback,
    } = descriptor;

    const reusable = callbacks.getExistingClipById(itemId);
    if (reusable && this.context.timelineClipLoader.isReusableClipMatch({ reusable, descriptor })) {
      const updated = await this.context.timelineClipLoader.updateReusableClip({
        clipData,
        descriptor,
        reusable,
        toVideoEffects: callbacks.toVideoEffects,
        getTrackRuntimeForClip: callbacks.getTrackRuntimeForClip,
        applySolidLayout: callbacks.applySolidLayout,
      });

      nextClips.push(updated.clip);
      nextClipById.set(itemId, updated.clip);
      return {
        sequentialTimeUs: updated.sequentialTimeUs,
      };
    }

    if (
      clipType === 'background' ||
      clipType === 'text' ||
      clipType === 'shape' ||
      clipType === 'adjustment' ||
      clipType === 'hud'
    ) {
      const fixedDuration = callbacks.resolveFixedClipEnd({
        startUs,
        requestedTimelineDurationUs,
        sequentialTimeUs,
      });
      sequentialTimeUs = fixedDuration.sequentialTimeUs;

      callbacks.replaceExistingClip({ reusable, itemId });
      const compositorClip = this.context.timelineFixedClipBuilder.build({
        clipData,
        descriptor: {
          clipType,
          itemId,
          trackId,
          layer,
          startUs,
          endUs: fixedDuration.endUs,
          requestedTimelineDurationUs,
          speed,
        },
        toVideoEffects: callbacks.toVideoEffects,
      });
      callbacks.registerLoadedClip({
        clip: compositorClip,
        nextClips,
        nextClipById,
      });
      if (clipType === 'hud') {
        await this.context.timelineFixedClipBuilder.initializeHudMediaStates({
          clip: compositorClip,
          deps,
        });
      }
      return { sequentialTimeUs };
    }

    if (!sourcePath) {
      return {
        sequentialTimeUs: Math.max(sequentialTimeUs, endUsFallback),
      };
    }

    callbacks.replaceExistingClip({ reusable, itemId });

    const fileHandle = await deps.getFileHandleByPath(sourcePath);
    if (!fileHandle) {
      return {
        sequentialTimeUs: Math.max(sequentialTimeUs, endUsFallback),
      };
    }

    const file = (await deps.getFileByPath?.(sourcePath)) ?? (await fileHandle.getFile());
    const isImage =
      (typeof file?.type === 'string' && file.type.startsWith('image/')) ||
      getMediaTypeFromFilename(sourcePath) === 'image';
    if (isImage) {
      const fixedDuration = callbacks.resolveFixedClipEnd({
        startUs,
        requestedTimelineDurationUs,
        sequentialTimeUs,
      });
      sequentialTimeUs = fixedDuration.sequentialTimeUs;

      const imageSource = new ImageSource({ resource: new OffscreenCanvas(2, 2) as any });
      let bitmap: ImageBitmap | null = null;
      const loadedImage = await this.context.rasterImageLoader.load({ sourcePath, deps });
      if (loadedImage) {
        bitmap = loadedImage.bitmap;
        imageSource.resize(loadedImage.width, loadedImage.height);
        (imageSource as any).resource = bitmap as any;
        imageSource.update();
      }
      const compositorClip = this.context.timelineMediaClipBuilder.createImageClip({
        clipData,
        descriptor: {
          itemId,
          trackId,
          layer,
          sourcePath,
          fileHandle,
          startUs,
          endUs: fixedDuration.endUs,
          requestedTimelineDurationUs,
          speed,
        },
        bitmap,
        imageSource,
        toVideoEffects: callbacks.toVideoEffects,
      });
      callbacks.registerLoadedClip({
        clip: compositorClip,
        nextClips,
        nextClipById,
      });
      return { sequentialTimeUs };
    }

    try {
      const loadedVideo = await this.context.mediaClipLoader.loadVideoRuntime({
        mediabunny,
        file,
        sourceStartUs,
        requestedTimelineDurationUs,
        requestedSourceDurationUs,
        requestedSourceRangeDurationUs,
        startUs,
      });
      if (!loadedVideo) {
        return { sequentialTimeUs };
      }

      sequentialTimeUs = Math.max(sequentialTimeUs, loadedVideo.endUs);
      const compositorClip = this.context.timelineMediaClipBuilder.createVideoClip({
        clipData,
        descriptor: {
          itemId,
          trackId,
          layer,
          sourcePath,
          fileHandle,
          startUs,
          endUs: loadedVideo.endUs,
          durationUs: loadedVideo.durationUs,
          sourceStartUs,
          sourceRangeDurationUs: loadedVideo.sourceRangeDurationUs,
          sourceDurationUs: loadedVideo.sourceDurationUs,
          speed,
          freezeFrameSourceUs,
        },
        input: loadedVideo.input,
        sink: loadedVideo.sink,
        firstTimestampS: loadedVideo.firstTimestampS,
        frameRate: loadedVideo.frameRate,
        imageSource: loadedVideo.imageSource,
        toVideoEffects: callbacks.toVideoEffects,
      });
      callbacks.registerLoadedClip({
        clip: compositorClip,
        nextClips,
        nextClipById,
      });
      return { sequentialTimeUs };
    } catch (err: any) {
      if (err?.message !== 'Input has an unsupported or unrecognizable format.') {
        console.error(`[VideoCompositor] Failed to load video clip ${itemId}:`, err);
      }
      return {
        sequentialTimeUs: Math.max(sequentialTimeUs, endUsFallback),
      };
    }
  }
}
