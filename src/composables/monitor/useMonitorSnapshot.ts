import { ref, type Ref } from 'vue';
import type { useProjectStore } from '~/stores/project.store';
import type { useTimelineStore } from '~/stores/timeline.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
import { buildStopFrameBaseName } from '~/utils/stop-frames';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { IMAGES_DIR_NAME } from '~/utils/constants';
import { dispatchTimelineThumbnailGeneration } from '~/timeline/services/timelineThumbnailService';

export function useMonitorSnapshot(input: {
  projectStore: ReturnType<typeof useProjectStore>;
  timelineStore: ReturnType<typeof useTimelineStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  isLoading: Ref<boolean>;
  loadError: Ref<string | null>;
  uiCurrentTimeUs: Ref<number>;
  workerTimelineClips: Ref<unknown>;
  rawWorkerTimelineClips: Ref<unknown>;
}) {
  const toast = useToast();
  const uiStore = useUiStore();

  const isSavingStopFrame = ref(false);

  function getClipsPayload() {
    return JSON.parse(
      JSON.stringify(input.workerTimelineClips.value ?? input.rawWorkerTimelineClips.value),
    );
  }

  async function saveTimelineThumbnail() {
    if (input.isLoading.value || input.loadError.value) return;
    if (!input.projectStore.currentProjectId || !input.projectStore.currentTimelinePath) return;
    if (!input.workspaceStore.workspaceHandle) return;

    dispatchTimelineThumbnailGeneration({
      projectId: input.projectStore.currentProjectId,
      timelinePath: input.projectStore.currentTimelinePath,
      timeUs: input.uiCurrentTimeUs.value,
      clipsPayload: getClipsPayload() as any[],
      workspaceHandle: input.workspaceStore.workspaceHandle,
      resolvedStorageTopology: input.workspaceStore.resolvedStorageTopology,
      getFileHandleByPath: async (path: string) => input.projectStore.getFileHandleByPath(path),
      getFileByPath: async (path: string) => input.projectStore.getFileByPath(path),
      width: 400,
      height: 225,
      quality: 0.7,
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

      const { client } = getExportWorkerClient();
      setExportHostApi(
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
          color: 'red',
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
        color: 'red',
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
