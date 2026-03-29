import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineDocument } from '~/timeline/types';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { dispatchTimelineThumbnailGeneration } from '~/timeline/services/timeline-thumbnail.service';

export function generateTimelineThumbnail(params: {
  timelinePath: string;
  timelineDoc: TimelineDocument;
}): void {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();

  if (!projectStore.currentProjectId || !workspaceStore.workspaceHandle) return;

  const projectId = projectStore.currentProjectId;
  const timelinePath = params.timelinePath;
  const timelineDoc = JSON.parse(JSON.stringify(params.timelineDoc)) as TimelineDocument;

  // We still need to run buildVideoWorkerPayloadFromTracks asynchronously
  // outside the critical path, but before dispatching the thumbnail task
  void (async () => {
    try {
      const { buildVideoWorkerPayloadFromTracks } = await import('~/composables/timeline/export');

      const builtVideo = await buildVideoWorkerPayloadFromTracks({
        tracks: timelineDoc.tracks,
        projectStore,
        workspaceStore,
      });

      const rawClips = builtVideo.payload;
      if (rawClips.length === 0) return;

      const durationUs = selectTimelineDurationUs(timelineDoc);
      const previewTimeUs = Math.max(
        0,
        Math.min(Math.round(durationUs / 2), Math.max(0, durationUs - 1)),
      );

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
      console.error('Failed to prepare background timeline thumbnail generation:', error);
    }
  })();
}
