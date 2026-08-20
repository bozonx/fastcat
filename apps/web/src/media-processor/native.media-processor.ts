import { ticksToSeconds } from '~/utils/time';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { getTimelineFormat, resolveEffectiveTimelineFormat } from '~/timeline/format';
import { buildNativeMonitorScene } from '~/utils/native-monitor-scene';
import {
  getNativeFileHandlePath,
  nativeRenderTimelineFrameWebp,
  nativeVideoFrameWebp,
  nativeVideoFrameWebps,
} from '~/utils/tauri-media-processing';
import { fitDimensions } from './media-processor.utils';
import type {
  ExtractTimelineFrameBlobOptions,
  ExtractVideoFrameBlobOptions,
  ExtractVideoFrameBlobsOptions,
  IMediaProcessor,
} from './media-processor.types';

const NATIVE_THUMBNAIL_SEEK_THRESHOLD_SECONDS = 1;

export function createNativeMediaProcessor(): IMediaProcessor {
  return {
    id: 'native',

    async extractVideoFrameBlob(options: ExtractVideoFrameBlobOptions): Promise<Blob | null> {
      const projectStore = useProjectStore();
      const sourceHandle = await projectStore.getFileHandleByPath(options.projectRelativePath);
      const sourcePath = getNativeFileHandlePath(sourceHandle);
      if (!sourcePath) {
        throw new Error(`No native path for thumbnail task: ${options.projectRelativePath}`);
      }

      return await nativeVideoFrameWebp({
        sourcePath,
        timeSec: options.timeSec,
        positionFraction: options.positionFraction,
        maxWidth: options.maxWidth,
        maxHeight: options.maxHeight,
        quality: options.quality,
      });
    },

    async extractVideoFrameBlobs(options: ExtractVideoFrameBlobsOptions): Promise<(Blob | null)[]> {
      const projectStore = useProjectStore();
      const sourceHandle = await projectStore.getFileHandleByPath(options.projectRelativePath);
      const sourcePath = getNativeFileHandlePath(sourceHandle);
      if (!sourcePath) {
        throw new Error(`No native path for thumbnail task: ${options.projectRelativePath}`);
      }

      return await nativeVideoFrameWebps({
        sourcePath,
        timesSec: options.timesSec,
        maxWidth: options.maxWidth,
        maxHeight: options.maxHeight,
        quality: options.quality,
        seekThresholdSec: NATIVE_THUMBNAIL_SEEK_THRESHOLD_SECONDS,
      });
    },

    async extractTimelineFrameBlob(options: ExtractTimelineFrameBlobOptions): Promise<Blob | null> {
      const projectStore = useProjectStore();
      const workspaceStore = useWorkspaceStore();
      const fallbackFormat = resolveEffectiveTimelineFormat(
        getTimelineFormat(options.timelineDoc),
        projectStore.projectSettings.project,
      );

      const scene = await buildNativeMonitorScene({
        timelineDoc: options.timelineDoc,
        projectStore,
        workspaceStore,
        masterGain: options.timelineDoc.metadata?.fastcat?.masterGain ?? 1,
        masterMuted: false,
        previewScale: 1,
        includeAudio: false,
        isExport: options.isExport,
        fallbackFormat,
      });
      if (scene.layers.length === 0) return null;

      const { width, height } = resolveTimelineFrameDimensions(scene, options);
      return await nativeRenderTimelineFrameWebp({
        scene,
        timeSec: ticksToSeconds(options.timeTicks),
        width,
        height,
        quality: options.quality ?? 0.8,
        isTransparent: options.isTransparent,
        effectQuality: options.effectQuality,
      });
    },

    async cancelVideoFrameExtraction() {},

    async releaseVideoFrameExtractor() {},

    async dispose() {},
  };
}

function resolveTimelineFrameDimensions(
  scene: { width: number; height: number },
  options: ExtractTimelineFrameBlobOptions,
): { width: number; height: number } {
  if (options.width && options.height) {
    return { width: options.width, height: options.height };
  }

  const maxWidth = options.maxWidth ?? 1280;
  const maxHeight = options.maxHeight ?? 1280;
  return fitDimensions(scene.width, scene.height, maxWidth, maxHeight);
}
