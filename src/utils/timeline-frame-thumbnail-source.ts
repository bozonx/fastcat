import { createDevLogger } from '~/utils/dev-logger';
import { useProjectStore } from '~/stores/project.store';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { useMediaProcessor } from '~/composables/useMediaProcessor';
import { fitDimensions } from '~/media-processor/media-processor.utils';

const log = createDevLogger('timeline-frame-thumbnail-source');

/**
 * Produces video-frame blobs for a sequence of source times. Shared shape used
 * by the thumbnail generator so media clips (decode a file) and nested-timeline
 * clips (composite an .otio doc) flow through the same caching/OPFS machinery.
 */
export interface ThumbnailFrameSource {
  /** How many frames to request per render batch. */
  readonly batchSize: number;
  /**
   * Render frames at the given source times (seconds). Returns one entry per
   * requested time; `null` marks a frame that could not be produced.
   */
  extract(timesSec: number[], isCancelled: () => boolean): Promise<(Blob | null)[]>;
  /** Release any decoder/compositor resources held for the task. */
  dispose(): Promise<void>;
}

/**
 * Builds a frame source that renders frames from a nested timeline document
 * (an `.otio` clip used as a timeline clip) at arbitrary times. Rendering goes
 * through the same compositor as the monitor/export so previews match output.
 *
 * Returns `null` when the nested timeline has no visual layers (e.g. audio-only)
 * so the caller can skip thumbnail generation.
 */
export async function createTimelineFrameSource(params: {
  projectRelativePath: string;
  maxWidth: number;
  maxHeight: number;
  quality: number;
}): Promise<ThumbnailFrameSource | null> {
  const projectStore = useProjectStore();

  const file = await projectStore.getFileByPath(params.projectRelativePath);
  if (!file) {
    throw new Error(`Nested timeline file not found: ${params.projectRelativePath}`);
  }
  const text = await file.text();
  const doc = parseTimelineFromOtio(text, {
    id: 'nested-thumbnail',
    name: params.projectRelativePath.split('/').pop() ?? 'nested',
    format: projectStore.projectSettings.project,
  });

  const processor = useMediaProcessor();

  // Validate that the timeline has visual content by rendering a test frame at 0.
  const testBlob = await processor.extractTimelineFrameBlob({
    timelineDoc: doc,
    timeUs: 0,
    maxWidth: params.maxWidth,
    maxHeight: params.maxHeight,
    quality: params.quality,
  });
  if (!testBlob) return null;

  // Re-resolve dimensions so the source reports a consistent size for every frame.
  let format: { width: number; height: number };
  if (processor.id === 'native') {
    const { buildNativeMonitorScene } = await import('~/utils/native-monitor-scene');
    const { useWorkspaceStore } = await import('~/stores/workspace.store');
    const { resolveEffectiveTimelineFormat, getTimelineFormat } = await import('~/timeline/format');
    const scene = await buildNativeMonitorScene({
      timelineDoc: doc,
      projectStore,
      workspaceStore: useWorkspaceStore(),
      masterGain: doc.metadata?.fastcat?.masterGain ?? 1,
      masterMuted: false,
      previewScale: 1,
      includeAudio: false,
      fallbackFormat: resolveEffectiveTimelineFormat(
        getTimelineFormat(doc),
        projectStore.projectSettings.project,
      ),
    });
    format = { width: scene.width, height: scene.height };
  } else {
    const { buildVideoWorkerPayloadFromTracks } =
      await import('~/timeline/application/workerPayloadBuilder');
    const { useWorkspaceStore } = await import('~/stores/workspace.store');
    const { resolveEffectiveTimelineFormat, getTimelineFormat } = await import('~/timeline/format');
    const builtVideo = await buildVideoWorkerPayloadFromTracks({
      tracks: doc.tracks,
      projectStore,
      workspaceStore: useWorkspaceStore(),
    });
    const payload = builtVideo.payload;
    if (payload.length === 0) {
      format = { width: 0, height: 0 };
    } else {
      format = resolveEffectiveTimelineFormat(
        getTimelineFormat(doc),
        projectStore.projectSettings.project,
      );
    }
  }

  const { width, height } = fitDimensions(
    format.width,
    format.height,
    params.maxWidth,
    params.maxHeight,
  );

  return {
    batchSize: processor.id === 'native' ? 8 : 4,
    async extract(timesSec, isCancelled) {
      const blobs: (Blob | null)[] = [];
      for (const timeSec of timesSec) {
        if (isCancelled()) {
          blobs.push(null);
          continue;
        }
        try {
          blobs.push(
            await processor.extractTimelineFrameBlob({
              timelineDoc: doc,
              timeUs: Math.round(timeSec * 1_000_000),
              width,
              height,
              quality: params.quality,
            }),
          );
        } catch (e) {
          if (isCancelled()) {
            blobs.push(null);
            continue;
          }
          log.warn('Failed to render nested timeline frame', timeSec, e);
          blobs.push(null);
        }
      }
      return blobs;
    },
    async dispose() {},
  };
}
