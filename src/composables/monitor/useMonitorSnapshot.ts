import { ref, type Ref } from 'vue';
import type {
  WorkerTimelineClip,
  WorkerVideoPayloadItem,
} from '~/composables/timeline/export/types';
import type { useProjectStore } from '~/stores/project.store';
import type { useTimelineStore } from '~/stores/timeline.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
import { buildStopFrameBaseName } from '~/utils/stop-frames';
import { getThumbnailWorkerClient, setThumbnailHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { IMAGES_DIR_NAME } from '~/utils/constants';
import { dispatchTimelineThumbnailGeneration } from '~/timeline/services/timeline-thumbnail.service';
import { cloneValue } from '~/utils/clone';

export function useMonitorSnapshot(input: {
  projectStore: ReturnType<typeof useProjectStore>;
  timelineStore: ReturnType<typeof useTimelineStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  isLoading: Ref<boolean>;
  loadError: Ref<string | null>;
  uiCurrentTimeUs: Ref<number>;
  workerTimelineClips: Ref<WorkerTimelineClip[]>;
  rawWorkerTimelineClips: Ref<WorkerTimelineClip[] | undefined>;
  workerTimelinePayload: Ref<WorkerVideoPayloadItem[]>;
}) {
  const toast = useToast();
  const uiStore = useUiStore();

  const isSavingStopFrame = ref(false);

  function getClipsPayload(): WorkerVideoPayloadItem[] {
    const payload =
      input.workerTimelinePayload.value?.length > 0
        ? input.workerTimelinePayload.value
        : input.workerTimelineClips.value?.length > 0
          ? input.workerTimelineClips.value
          : (input.rawWorkerTimelineClips.value ?? []);
    return cloneValue(payload) as WorkerVideoPayloadItem[];
  }

  async function saveTimelineThumbnail() {
    if (input.isLoading.value || input.loadError.value) return;
    if (!input.projectStore.currentProjectId || !input.projectStore.currentTimelinePath) return;
    if (!input.workspaceStore.workspaceHandle) return;

    const projectWidth = Number(input.projectStore.projectSettings?.project?.width || 1280);
    const projectHeight = Number(input.projectStore.projectSettings?.project?.height || 720);
    const maxSide = 1280;

    let targetWidth = projectWidth;
    let targetHeight = projectHeight;

    if (projectWidth > projectHeight) {
      if (projectWidth > maxSide) {
        targetWidth = maxSide;
        targetHeight = Math.round((projectHeight * maxSide) / projectWidth);
      }
    } else {
      if (projectHeight > maxSide) {
        targetHeight = maxSide;
        targetWidth = Math.round((projectWidth * maxSide) / projectHeight);
      }
    }

    dispatchTimelineThumbnailGeneration({
      projectId: input.projectStore.currentProjectId,
      timelinePath: input.projectStore.currentTimelinePath,
      timeUs: input.uiCurrentTimeUs.value,
      clipsPayload: getClipsPayload(),
      workspaceHandle: input.workspaceStore.workspaceHandle,
      resolvedStorageTopology: input.workspaceStore.resolvedStorageTopology,
      getFileHandleByPath: async (path: string) => input.projectStore.getFileHandleByPath(path),
      getFileByPath: async (path: string) => input.projectStore.getFileByPath(path),
      width: targetWidth,
      height: targetHeight,
      quality: 0.8,
      notifyUi: true,
    });
  }

  async function createStopFrameSnapshot() {
    if (isSavingStopFrame.value) return;
    if (input.isLoading.value) return;
    if (input.loadError.value) return;

    const timelineName =
      input.projectStore.currentFileName ||
      input.projectStore.currentTimelinePath ||
      input.timelineStore.timelineDoc?.name ||
      'timeline';

    const fps = input.projectStore.projectSettings?.project?.fps ?? 30;
    const timeUs = input.uiCurrentTimeUs.value;

    const qualityPercent = input.workspaceStore.userSettings.stopFrames?.qualityPercent ?? 85;
    const quality = Math.max(0.01, Math.min(1, qualityPercent / 100));
    const extension = 'webp';
    const baseName = buildStopFrameBaseName({
      timelineName,
      timeUs,
      fps,
    });

    let filename = `${baseName}.${extension}`;
    let attempt = 0;
    const MAX_ATTEMPTS = 10_000;
    while (attempt < MAX_ATTEMPTS) {
      const existingHandle = await input.projectStore.getProjectFileHandleByRelativePath({
        relativePath: `${IMAGES_DIR_NAME}/stop_frames/${filename}`,
        create: false,
      });
      if (!existingHandle) {
        break;
      }
      attempt += 1;
      const suffix = String(attempt).padStart(3, '0');
      filename = `${baseName}_${suffix}.${extension}`;
    }

    isSavingStopFrame.value = true;
    try {
      const exportWidth = Math.round(
        Number(input.projectStore.projectSettings?.project?.width ?? 0),
      );
      const exportHeight = Math.round(
        Number(input.projectStore.projectSettings?.project?.height ?? 0),
      );

      const { client } = getThumbnailWorkerClient();
      setThumbnailHostApi(
        createVideoCoreHostApi({
          getCurrentProjectId: () => input.projectStore.currentProjectId,
          getWorkspaceHandle: () => input.workspaceStore.workspaceHandle,
          getResolvedStorageTopology: () => input.workspaceStore.resolvedStorageTopology,
          getFileHandleByPath: async (path: string) => input.projectStore.getFileHandleByPath(path),
          getFileByPath: async (path: string) => input.projectStore.getFileByPath(path),
          onExportProgress: () => {},
        }),
      );

      const clipsPayload = getClipsPayload();

      const blob = await client.extractFrameToBlob(
        timeUs,
        exportWidth,
        exportHeight,
        clipsPayload,
        quality,
      );

      if (!blob) {
        throw new Error('Worker returned empty blob');
      }

      const fileHandle = await input.projectStore.getProjectFileHandleByRelativePath({
        relativePath: `${IMAGES_DIR_NAME}/stop_frames/${filename}`,
        create: true,
      });

      if (!fileHandle) {
        toast.add({
          color: 'error',
          title: 'Snapshot failed',
          description: 'Could not access project folder for writing',
        });
        return;
      }

      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      toast.add({
        color: 'primary',
        title: 'Snapshot created',
        description: `Saved to ${IMAGES_DIR_NAME}/stop_frames/${filename}`,
      });

      uiStore.notifyFileManagerUpdate();
    } catch (err) {
      console.error('[Monitor] Failed to create stop frame snapshot', err);
      toast.add({
        color: 'error',
        title: 'Snapshot failed',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      isSavingStopFrame.value = false;
    }
  }

  return {
    isSavingStopFrame,
    createStopFrameSnapshot,
    saveTimelineThumbnail,
  };
}
