import { createDevLogger } from '~/utils/dev-logger';
import PQueue from 'p-queue';
import { getMediaTypeFromFilename } from '../../media-types';
import { runResilientWorkerFileIo } from '../../../workers/core/io-governor';
import type { WorkerVideoPayloadItem } from '../../../composables/timeline/export/types';
import type { VideoClipEffect } from '~/timeline/types';
import type { MediaClipLoader, MediaClipLoaderMediabunny } from './MediaClipLoader';
import type { RasterImageLoader, MediaSourceLoaderDeps } from './RasterImageLoader';
import type { TimelineClipDescriptor, TimelineClipLoader } from './TimelineClipLoader';
import type { TimelineClipAssetLoader } from './TimelineClipAssetLoader';
import type { ClipFactory } from './ClipFactory';
import type { LayoutApplier } from './LayoutApplier';
import type { CompositorClip, CompositorTrack } from './types';
import { resolveBlendMode } from './types';
import { createPlaceholderImageSource } from './placeholderImageSource';
const log = createDevLogger('TimelineLoadOrchestrator');

export type TimelineLoadOrchestratorDeps = MediaSourceLoaderDeps;

export interface TimelineLoadOrchestratorContext {
  timelineClipLoader: TimelineClipLoader;
  timelineClipAssetLoader: TimelineClipAssetLoader;
  clipFactory: ClipFactory;
  layoutApplier: LayoutApplier;
  mediaClipLoader: MediaClipLoader;
  rasterImageLoader: RasterImageLoader;
}

export interface TimelineLoadOrchestratorCallbacks {
  checkCancel?: () => boolean;
  abortSignal?: AbortSignal;
  destroyClip: (clip: CompositorClip) => void;
  getExistingClipById: (itemId: string) => CompositorClip | undefined;
  getFallbackTrackId: (clipData: { layer?: number }) => string | null;
  getTrackRuntimeForClip: (
    clip: Pick<CompositorClip, 'trackId' | 'layer'>,
  ) => CompositorTrack | null;
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
  timelineClips: ReadonlyArray<WorkerVideoPayloadItem>;
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

  private getClipLoadQueue(isOpfs: boolean): PQueue {
    return new PQueue({ concurrency: isOpfs ? 2 : 8 });
  }

  public async load(
    params: TimelineLoadOrchestratorParams,
  ): Promise<TimelineLoadOrchestratorResult> {
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
        (abortErr as Error).name = 'AbortError';
        throw abortErr;
      }

      const descriptor = this.context.timelineClipLoader.describe({
        index,
        clipData: clipData as unknown as Record<string, unknown>,
        sequentialTimeUs,
        fallbackTrackId: callbacks.getFallbackTrackId(
          clipData as unknown as Record<string, unknown>,
        ),
      });
      if (!descriptor) {
        continue;
      }

      const processed = await this.processDescriptor({
        descriptor,
        clipData: clipData as unknown as Record<string, unknown>,
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
    clipData: { layer?: number };
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
        clipData: clipData as Record<string, unknown>,
        descriptor,
        reusable,
        toVideoEffects: callbacks.toVideoEffects,
        getTrackRuntimeForClip: callbacks.getTrackRuntimeForClip,
        applySolidLayout: callbacks.applySolidLayout,
      });

      if (updated.clip.clipKind === 'hud' && updated.clip.hudDirty) {
        await this.context.timelineClipAssetLoader.initializeHudMediaStates({
          clip: updated.clip,
          deps,
          mediabunny,
        });
      }

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
      const compositorClip = this.context.timelineClipAssetLoader.build({
        clipData: clipData as Record<string, unknown>,
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
        await this.context.timelineClipAssetLoader.initializeHudMediaStates({
          clip: compositorClip,
          deps,
          mediabunny,
        });
      }
      if (descriptor.maskPath) {
        await this.context.timelineClipAssetLoader.initializeMaskState({
          clip: compositorClip,
          deps,
          mediabunny,
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

    const isOpfs = (() => {
      try {
        return fileHandle instanceof FileSystemFileHandle;
      } catch {
        return false;
      }
    })();

    const file =
      (await deps.getFileByPath?.(sourcePath)) ??
      (await runResilientWorkerFileIo(fileHandle, () => fileHandle.getFile()));
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

      const imageSource = createPlaceholderImageSource();
      let bitmap: ImageBitmap | null = null;
      const loadedImage = await this.context.rasterImageLoader.load({ sourcePath, deps });
      if (loadedImage) {
        bitmap = loadedImage.bitmap;
        imageSource.resize(loadedImage.width, loadedImage.height);
        (imageSource as { resource?: unknown }).resource = bitmap as unknown;
        imageSource.update();
      }
      const compositorClip = this.context.clipFactory.createImageClip({
        itemId,
        trackId,
        layer,
        sourcePath,
        fileHandle,
        startUs,
        endUs: fixedDuration.endUs,
        durationUs: Math.max(0, requestedTimelineDurationUs),
        sourceStartUs: 0,
        sourceRangeDurationUs: Math.max(0, requestedTimelineDurationUs),
        sourceDurationUs: Math.max(0, requestedTimelineDurationUs),
        speed,
        bitmap,
        imageSource,
        opacity: (clipData as Record<string, unknown>).opacity as number | undefined,
        blendMode: resolveBlendMode((clipData as Record<string, unknown>).blendMode),
        effects: callbacks.toVideoEffects((clipData as Record<string, unknown>).effects),
        transform: (clipData as Record<string, unknown>).transform as
          | import('~/timeline/types').ClipTransform
          | undefined,
        sourceOrientation: (clipData as Record<string, unknown>)
          .sourceOrientation as CompositorClip['sourceOrientation'],
        transitionIn: (clipData as Record<string, unknown>).transitionIn as
          | import('~/timeline/types').ClipTransition
          | undefined,
        transitionOut: (clipData as Record<string, unknown>).transitionOut as
          | import('~/timeline/types').ClipTransition
          | undefined,
        mask: (clipData as Record<string, unknown>).mask as
          | import('~/timeline/types').ClipMask
          | undefined,
      });
      if (bitmap) {
        const frameW = Math.max(1, Math.round(bitmap.width ?? 1));
        const frameH = Math.max(1, Math.round(bitmap.height ?? 1));
        this.context.layoutApplier.applySpriteLayout(frameW, frameH, compositorClip);
      }
      callbacks.registerLoadedClip({
        clip: compositorClip,
        nextClips,
        nextClipById,
      });
      if (descriptor.maskPath) {
        await this.context.timelineClipAssetLoader.initializeMaskState({
          clip: compositorClip,
          deps,
          mediabunny,
        });
      }
      return { sequentialTimeUs };
    }

    const queue = this.getClipLoadQueue(isOpfs);

    try {
      const loadedVideo = await queue.add(() =>
        this.context.mediaClipLoader.loadVideoRuntime({
          mediabunny,
          file,
          sourceStartUs,
          requestedTimelineDurationUs,
          requestedSourceDurationUs,
          requestedSourceRangeDurationUs,
          startUs,
          abortSignal: callbacks.abortSignal,
        }),
      );
      if (!loadedVideo) {
        return { sequentialTimeUs };
      }

      sequentialTimeUs = Math.max(sequentialTimeUs, loadedVideo.endUs);
      const compositorClip = this.context.clipFactory.createVideoClip({
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        input: loadedVideo.input as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sink: loadedVideo.sink as any,
        firstTimestampS: loadedVideo.firstTimestampS,
        frameRate: loadedVideo.frameRate,
        imageSource: loadedVideo.imageSource,
        sourceRotation: loadedVideo.sourceRotation,
        opacity: (clipData as Record<string, unknown>).opacity as number | undefined,
        blendMode: resolveBlendMode((clipData as Record<string, unknown>).blendMode),
        effects: callbacks.toVideoEffects((clipData as Record<string, unknown>).effects),
        transform: (clipData as Record<string, unknown>).transform as
          | import('~/timeline/types').ClipTransform
          | undefined,
        sourceOrientation: (clipData as Record<string, unknown>)
          .sourceOrientation as CompositorClip['sourceOrientation'],
        transitionIn: (clipData as Record<string, unknown>).transitionIn as
          | import('~/timeline/types').ClipTransition
          | undefined,
        transitionOut: (clipData as Record<string, unknown>).transitionOut as
          | import('~/timeline/types').ClipTransition
          | undefined,
        mask: (clipData as Record<string, unknown>).mask as
          | import('~/timeline/types').ClipMask
          | undefined,
      });
      callbacks.registerLoadedClip({
        clip: compositorClip,
        nextClips,
        nextClipById,
      });
      if (descriptor.maskPath) {
        await this.context.timelineClipAssetLoader.initializeMaskState({
          clip: compositorClip,
          deps,
          mediabunny,
        });
      }
      return { sequentialTimeUs };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message !== 'Input has an unsupported or unrecognizable format.'
      ) {
        log.error(`[VideoCompositor] Failed to load video clip ${itemId}:`, err);
      }
      return {
        sequentialTimeUs: Math.max(sequentialTimeUs, endUsFallback),
      };
    }
  }
}
