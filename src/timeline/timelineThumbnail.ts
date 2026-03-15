import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineDocument } from '~/timeline/types';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { TIMELINE_CLIP_THUMBNAILS } from '~/utils/constants';
import { addLatestMediaTask, MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';

export function generateTimelineThumbnail(params: {
  timelinePath: string;
  timelineDoc: TimelineDocument;
}): void {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();

  if (!projectStore.currentProjectId || !workspaceStore.workspaceHandle) return;

  const projectId = projectStore.currentProjectId;
  const timelinePath = params.timelinePath;
  const timelineDoc = structuredClone(params.timelineDoc);

  addLatestMediaTask({
    key: `timeline-thumbnail:${timelinePath}`,
    task: async () => {
      try {
        const { buildVideoWorkerPayloadFromTracks } = await import('~/composables/timeline/export');

        const builtVideo = await buildVideoWorkerPayloadFromTracks({
          tracks: timelineDoc.tracks,
          projectStore: projectStore as any,
          workspaceStore: workspaceStore as any,
        });

        const rawClips = builtVideo.payload;
        if (rawClips.length === 0) return;

        const durationUs = selectTimelineDurationUs(timelineDoc);
        const previewTimeUs = Math.max(
          0,
          Math.min(Math.round(durationUs / 2), Math.max(0, durationUs - 1)),
        );

        const width = Math.max(160, Math.round(TIMELINE_CLIP_THUMBNAILS.WIDTH));
        const height = Math.max(90, Math.round(TIMELINE_CLIP_THUMBNAILS.HEIGHT));

        const { client } = getExportWorkerClient();
        setExportHostApi(
          createVideoCoreHostApi({
            getCurrentProjectId: () => projectId,
            getWorkspaceHandle: () => workspaceStore.workspaceHandle,
            getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
            getFileHandleByPath: async (path: string) => projectStore.getFileHandleByPath(path),
            getFileByPath: async (path: string) => projectStore.getFileByPath(path),
            onExportProgress: () => {},
          }),
        );

        const blob = await client.extractFrameToBlob(previewTimeUs, width, height, rawClips, 0.8);
        if (!blob) return;

        await fileThumbnailGenerator.saveManualThumbnail({
          projectId,
          projectRelativePath: timelinePath,
          blob,
        });
      } catch (error) {
        console.error('Failed to generate background timeline thumbnail:', error);
      }
    },
    priority: MEDIA_TASK_PRIORITIES.timelineThumbnailLazy,
  });
}
