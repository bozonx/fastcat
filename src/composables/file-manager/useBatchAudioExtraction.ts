import { ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useBackgroundTasksStore } from '~/stores/background-tasks.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useUiStore } from '~/stores/ui.store';
import { useAudioExtractionCore } from '~/composables/file-manager/useAudioExtractionCore';

export function useBatchAudioExtraction() {
  const fileManager = useFileManager();
  const uiStore = useUiStore();
  const backgroundTasksStore = useBackgroundTasksStore();
  const { t } = useI18n();
  const toast = useToast();
  const isExtracting = ref(false);
  const { extractAudioFile } = useAudioExtractionCore();

  async function batchExtractAudio(entries: FsEntry[], isExternal: boolean) {
    if (isExtracting.value) return;

    const eligibleEntries = entries.filter(
      (e) =>
        e.kind === 'file' &&
        (getMediaTypeFromFilename(e.name) === 'video' ||
          getMediaTypeFromFilename(e.name) === 'audio'),
    );
    if (eligibleEntries.length === 0) return;

    isExtracting.value = true;
    const title = t('videoEditor.fileManager.batchExtractAudio.taskTitle', {
      count: eligibleEntries.length,
    });
    const bgTaskId = backgroundTasksStore.addTask({
      type: 'conversion',
      title,
      status: 'pending',
    });

    const taskIdPrefix = `audio-extract-batch-${Date.now()}`;
    const total = eligibleEntries.length;
    let completed = 0;
    let lastDirPath = '';

    try {
      backgroundTasksStore.updateTaskStatus(bgTaskId, 'running');
      let noAudioCount = 0;

      for (const entry of eligibleEntries) {
        try {
          const result = await extractAudioFile(entry, { isExternal, taskIdPrefix });
          if (result?.status === 'no-audio') {
            noAudioCount++;
            completed++;
            backgroundTasksStore.updateTaskProgress(bgTaskId, completed / total);
            continue;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          backgroundTasksStore.updateTaskStatus(bgTaskId, 'failed', `${entry.name}: ${message}`);
          throw err;
        }

        completed++;
        backgroundTasksStore.updateTaskProgress(bgTaskId, completed / total);

        if (entry.path) {
          const dirPath = entry.path.split('/').slice(0, -1).join('/');
          lastDirPath = dirPath;
          await fileManager.reloadDirectory(dirPath);
        }
      }

      backgroundTasksStore.updateTaskProgress(bgTaskId, 1);
      backgroundTasksStore.updateTaskStatus(bgTaskId, 'completed');

      if (noAudioCount > 0) {
        toast.add({
          title: t('videoEditor.fileManager.batchExtractAudio.noAudioTrack', {
            count: noAudioCount,
          }),
          color: 'warning',
        });
      }

      if (noAudioCount < eligibleEntries.length) {
        toast.add({
          title: t('videoEditor.fileManager.batchExtractAudio.success'),
          description: title,
          color: 'success',
        });
      }
    } catch {
      const task = backgroundTasksStore.tasks.find((t) => t.id === bgTaskId);
      if (task && task.status !== 'failed') {
        backgroundTasksStore.updateTaskStatus(bgTaskId, 'failed', task.error || 'Unknown error');
      }
      toast.add({
        title: t('videoEditor.fileManager.batchExtractAudio.failed'),
        color: 'error',
      });
    } finally {
      isExtracting.value = false;
      if (lastDirPath) {
        await fileManager.reloadDirectory(lastDirPath);
      }
      uiStore.notifyFileManagerUpdate();
    }
  }

  return {
    isExtracting,
    batchExtractAudio,
  };
}
