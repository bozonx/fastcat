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
import { getTimelineFormat, resolveEffectiveTimelineFormat } from '~/timeline/format';
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
    // Honour project-settings inheritance so thumbnails match the monitor/export
    // size instead of the doc's stale creation-time snapshot.
    fallbackFormat: resolveEffectiveTimelineFormat(
      getTimelineFormat(timelineDoc),
      projectStore.projectSettings.project,
    ),
  });
}

/**
 * Renders a timeline frame to a WebP blob via the native (Tauri) offscreen
 * compositor. Returns `null` when the scene has no visual layers. The output is
 * fitted into `maxSize` (long edge) preserving the scene's aspect ratio, so
 * non-16:9 timelines aren't squashed. Shared by the timeline-manager thumbnail
 * and the monitor "save current frame as thumbnail" action.
 */
export async function renderNativeTimelineThumbnail(params: {
  timelineDoc: TimelineDocument;
  timeUs: number;
  maxSize: number;
  quality: number;
}): Promise<Blob | null> {
  const scene = await buildNativeMonitorScene(params.timelineDoc);
  if (scene.layers.length === 0) return null;
  const longEdge = Math.max(scene.width, scene.height);
  const scale = longEdge > params.maxSize ? params.maxSize / longEdge : 1;
  return await nativeRenderTimelineFrameWebp({
    scene,
    timeSec: params.timeUs / 1_000_000,
    width: Math.max(160, Math.round(scene.width * scale)),
    height: Math.max(90, Math.round(scene.height * scale)),
    quality: params.quality,
  });
}

/**
 * Renders a full-resolution timeline frame to a WebP blob via the native (Tauri)
 * offscreen compositor at EXPORT (ultra) quality: full render scale and the ultra
 * effect/transition sample budgets, matching `native_timeline_export` output. Used
 * by the monitor "create stop-frame snapshot" action so saved frames look identical
 * to an export still. Returns `null` when the scene has no visual layers.
 */
export async function renderNativeStopFrameWebp(params: {
  timelineDoc: TimelineDocument;
  timeUs: number;
  quality: number;
}): Promise<Blob | null> {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();
  const fallbackFormat = resolveEffectiveTimelineFormat(
    getTimelineFormat(params.timelineDoc),
    projectStore.projectSettings.project,
  );
  const scene = await buildNativeMonitorScenePayload({
    timelineDoc: params.timelineDoc,
    projectStore,
    workspaceStore,
    masterGain: params.timelineDoc.metadata?.fastcat?.masterGain ?? 1,
    masterMuted: false,
    previewScale: 1,
    includeAudio: false,
    // Ultra render scale + ultra effect quality, identical to the export pipeline.
    isExport: true,
    fallbackFormat,
  });
  if (scene.layers.length === 0) return null;
  return await nativeRenderTimelineFrameWebp({
    scene,
    timeSec: params.timeUs / 1_000_000,
    width: scene.width,
    height: scene.height,
    quality: params.quality,
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
        const blob = await renderNativeTimelineThumbnail({
          timelineDoc,
          timeUs: previewTimeUs,
          maxSize: TIMELINE_MANAGER_THUMBNAILS.MAX_SIZE,
          quality: TIMELINE_MANAGER_THUMBNAILS.QUALITY,
        });
        if (!blob) return;
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
