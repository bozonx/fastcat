import { createDevLogger } from '~/utils/dev-logger';
import { ref, type Ref } from 'vue';
import type { useProjectStore } from '~/stores/project.store';
import type { useTimelineStore } from '~/stores/timeline.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import { useUiStore } from '~/stores/ui.store';
import { buildStopFrameBaseName } from '~/utils/stop-frames';
import { IMAGES_DIR_NAME } from '~/utils/constants';
import { withFileIoSlot } from '~/utils/io/io-governor';
import { useFileManager } from '~/composables/file-manager/useFileManager';

const log = createDevLogger('useMonitorSnapshot');

export function useMonitorSnapshot(input: {
  projectStore: ReturnType<typeof useProjectStore>;
  timelineStore: ReturnType<typeof useTimelineStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  isLoading: Ref<boolean>;
  loadError: Ref<string | null>;
  uiCurrentTimeUs: Ref<number>;
}) {
  const toast = useToast();
  const uiStore = useUiStore();
  const fileManager = useFileManager();

  const isSavingStopFrame = ref(false);

  async function saveTimelineThumbnail() {
    if (input.isLoading.value || input.loadError.value) return;
    if (!input.projectStore.currentProjectId || !input.projectStore.currentTimelinePath) return;

    const timelineDoc = input.timelineStore.timelineDoc;
    if (!timelineDoc) return;

    try {
      const [{ renderTimelineThumbnail }, { fileThumbnailGenerator }] = await Promise.all([
        import('~/timeline/timeline-thumbnail'),
        import('~/utils/file-thumbnail-generator'),
      ]);
      const blob = await renderTimelineThumbnail({
        timelineDoc,
        timeUs: input.uiCurrentTimeUs.value,
        maxSize: 1280,
        quality: 0.8,
      });
      if (!blob) return;
      await fileThumbnailGenerator.saveManualThumbnail({
        projectId: input.projectStore.currentProjectId,
        projectRelativePath: input.projectStore.currentTimelinePath,
        blob,
      });
      uiStore.notifyFileManagerUpdate();
    } catch (error) {
      log.error('Failed to save timeline thumbnail:', error);
    }

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

    const fps =
      input.timelineStore.timelineFormat?.fps ??
      input.projectStore.projectSettings?.project?.fps ??
      30;
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
      const timelineDoc = input.timelineStore.timelineDoc;
      if (!timelineDoc) return;
      const { renderStopFrameWebp } = await import('~/timeline/timeline-thumbnail');
      const blob = await renderStopFrameWebp({
        timelineDoc,
        timeUs,
        quality,
      });
      if (!blob) {
        throw new Error('Compositor returned no frame');
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

      await withFileIoSlot(async () => {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      });

      toast.add({
        color: 'success',
        title: 'Snapshot created',
        description: `Saved to ${IMAGES_DIR_NAME}/stop_frames/${filename}`,
      });
      await fileManager.reloadDirectory('');
      await fileManager.reloadDirectory('images');
      uiStore.notifyFileManagerUpdate();
    } catch (err) {
      log.error('[Monitor] Failed to create stop frame snapshot', err);
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
