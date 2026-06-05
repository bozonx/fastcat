import { createDevLogger } from '~/utils/dev-logger';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineDocument } from '~/timeline/types';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { cloneValue } from '~/utils/clone';
import { isTauriRuntime } from '~/utils/runtime';
import { nativeRenderTimelineFrameWebp } from '~/utils/tauri-media-processing';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { TIMELINE_MANAGER_THUMBNAILS } from '~/utils/constants';
import {
  buildNativeMonitorScene as buildNativeMonitorScenePayload,
  type NativeMonitorScene,
} from '~/utils/native-monitor-scene';
const log = createDevLogger('timeline-thumbnail');

export type { NativeMonitorScene };

export async function buildNativeMonitorScene(
  timelineDoc: TimelineDocument,
): Promise<NativeMonitorScene> {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();
  return await buildNativeMonitorScenePayload({
    timelineDoc,
    projectStore,
    workspaceStore,
    masterGain: timelineDoc.metadata?.fastcat?.masterGain ?? 1,
    masterMuted: false,
    previewScale: 1,
    includeAudio: false,
  });
}

export function generateTimelineThumbnail(params: {
  timelinePath: string;
  timelineDoc: TimelineDocument;
}): void {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();

  if (!projectStore.currentProjectId || (!workspaceStore.workspaceHandle && !isTauriRuntime())) {
    return;
  }

  const projectId = projectStore.currentProjectId;
  const timelinePath = params.timelinePath;
  const timelineDoc = cloneValue(params.timelineDoc);

  // We still need to run buildVideoWorkerPayloadFromTracks asynchronously
  // outside the critical path, but before dispatching the thumbnail task
  void (async () => {
    try {
      const durationUs = selectTimelineDurationUs(timelineDoc);
      // Ensure the preview time is strictly inside [0, duration) so the
      // underlying decoder never has to resolve a frame exactly at EOF.
      const previewTimeUs = Math.max(
        0,
        Math.min(Math.round(durationUs / 2), Math.max(0, durationUs - 1)),
      );

      if (isTauriRuntime()) {
        const scene = await buildNativeMonitorScene(timelineDoc);
        if (scene.layers.length === 0) return;
        const maxSize = TIMELINE_MANAGER_THUMBNAILS.MAX_SIZE;
        const longEdge = Math.max(scene.width, scene.height);
        const scale = longEdge > maxSize ? maxSize / longEdge : 1;
        const blob = await nativeRenderTimelineFrameWebp({
          scene,
          timeSec: previewTimeUs / 1_000_000,
          width: Math.max(160, Math.round(scene.width * scale)),
          height: Math.max(90, Math.round(scene.height * scale)),
          quality: TIMELINE_MANAGER_THUMBNAILS.QUALITY,
        });
        await fileThumbnailGenerator.saveManualThumbnail({
          projectId,
          projectRelativePath: timelinePath,
          blob,
        });
        return;
      }

      const [{ buildVideoWorkerPayloadFromTracks }, { dispatchTimelineThumbnailGeneration }] =
        await Promise.all([
          import('~/composables/timeline/export'),
          import('~/timeline/services/timeline-thumbnail.service'),
        ]);

      const builtVideo = await buildVideoWorkerPayloadFromTracks({
        tracks: timelineDoc.tracks,
        projectStore,
        workspaceStore,
      });

      const rawClips = builtVideo.payload;
      if (rawClips.length === 0) return;

      dispatchTimelineThumbnailGeneration({
        projectId,
        timelinePath,
        timeUs: previewTimeUs,
        clipsPayload: rawClips,
        workspaceHandle: workspaceStore.workspaceHandle!,
        resolvedStorageTopology: workspaceStore.resolvedStorageTopology,
        getFileHandleByPath: async (path: string) => projectStore.getFileHandleByPath(path),
        getFileByPath: async (path: string) => projectStore.getFileByPath(path),
        notifyUi: false,
      });
    } catch (error) {
      log.error('Failed to prepare background timeline thumbnail generation:', error);
    }
  })();
}
