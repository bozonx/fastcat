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
  const { t } = useI18n();

  const isSavingStopFrame = ref(false);

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
      timeTicks: timeUs,
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
      const isTransparent =
        input.projectStore.projectSettings?.monitor?.showTransparencyGrid ??
        input.projectStore.activeMonitor?.showTransparencyGrid ??
        false;
      const blob = await renderStopFrameWebp({
        timelineDoc,
        timeUs,
        quality,
        isTransparent,
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
          title: t('fastcat.monitor.snapshotFailed'),
          description: t('fastcat.monitor.snapshotNoWriteAccess'),
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
        title: t('fastcat.monitor.snapshotCreated'),
        description: t('fastcat.monitor.snapshotCreatedDescription', {
          path: `${IMAGES_DIR_NAME}/stop_frames/${filename}`,
        }),
      });
      await fileManager.reloadDirectory('');
      await fileManager.reloadDirectory('images');
      uiStore.notifyFileManagerUpdate();
    } catch (err) {
      log.error('[Monitor] Failed to create stop frame snapshot', err);
      toast.add({
        color: 'error',
        title: t('fastcat.monitor.snapshotFailed'),
        description: err instanceof Error ? err.message : t('fastcat.monitor.snapshotUnknownError'),
      });
    } finally {
      isSavingStopFrame.value = false;
    }
  }

  return {
    isSavingStopFrame,
    createStopFrameSnapshot,
  };
}
