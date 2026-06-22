import { createDevLogger } from '~/utils/dev-logger';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { createProjectHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import { getTimelineFormat, resolveEffectiveTimelineFormat } from '~/timeline/format';
import { isTauriRuntime } from '~/utils/runtime';

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

export function fitDimensions(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const safeW = width > 0 ? width : 16;
  const safeH = height > 0 ? height : 9;
  const scale = Math.min(1, maxWidth / safeW, maxHeight / safeH);
  return {
    width: Math.max(2, Math.round(safeW * scale)),
    height: Math.max(2, Math.round(safeH * scale)),
  };
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
  const workspaceStore = useWorkspaceStore();

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

  if (isTauriRuntime()) {
    const [{ buildNativeMonitorScene }, { nativeRenderTimelineFrameWebp }] = await Promise.all([
      import('~/timeline/timeline-thumbnail'),
      import('~/utils/tauri-media-processing'),
    ]);

    const scene = await buildNativeMonitorScene(doc);
    if (scene.layers.length === 0) return null;

    const { width, height } = fitDimensions(
      scene.width,
      scene.height,
      params.maxWidth,
      params.maxHeight,
    );

    return {
      // Native frames render one seek at a time; keep batches small so the
      // OPFS/cache loop can persist progress frequently.
      batchSize: 8,
      async extract(timesSec, isCancelled) {
        const blobs: (Blob | null)[] = [];
        for (const timeSec of timesSec) {
          if (isCancelled()) {
            blobs.push(null);
            continue;
          }
          try {
            blobs.push(
              await nativeRenderTimelineFrameWebp({
                scene,
                timeSec,
                width,
                height,
                quality: Math.round(params.quality * 100) / 100,
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

  // Web runtime: composite through the thumbnail worker.
  const [{ buildVideoWorkerPayloadFromTracks }, { getThumbnailWorkerClient, setThumbnailHostApi }] =
    await Promise.all([
      import('~/composables/timeline/export'),
      import('~/utils/video-editor/worker-client'),
    ]);

  if (!workspaceStore.workspaceHandle) {
    throw new Error('Workspace is not opened');
  }

  const builtVideo = await buildVideoWorkerPayloadFromTracks({
    tracks: doc.tracks,
    projectStore,
    workspaceStore,
  });
  const clipsPayload = builtVideo.payload;
  if (clipsPayload.length === 0) return null;

  const format = resolveEffectiveTimelineFormat(
    getTimelineFormat(doc),
    projectStore.projectSettings.project,
  );
  const { width, height } = fitDimensions(
    format.width,
    format.height,
    params.maxWidth,
    params.maxHeight,
  );

  setThumbnailHostApi(createProjectHostApi());
  const { client } = getThumbnailWorkerClient();

  return {
    batchSize: 4,
    async extract(timesSec, isCancelled) {
      const blobs: (Blob | null)[] = [];
      for (const timeSec of timesSec) {
        if (isCancelled()) {
          blobs.push(null);
          continue;
        }
        try {
          blobs.push(
            await client.extractFrameToBlob(
              Math.round(timeSec * 1_000_000),
              width,
              height,
              clipsPayload,
              params.quality,
            ),
          );
        } catch (e) {
          if (isCancelled()) {
            blobs.push(null);
            continue;
          }
          log.warn('Failed to render nested timeline frame (web)', timeSec, e);
          blobs.push(null);
        }
      }
      return blobs;
    },
    async dispose() {},
  };
}
