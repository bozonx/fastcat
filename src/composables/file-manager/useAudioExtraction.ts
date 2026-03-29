import { ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import { getExportWorkerClient, setExportHostApi } from '~/utils/video-editor/worker-client';
import { createVideoCoreHostApi } from '~/utils/video-editor/createVideoCoreHostApi';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';

export function useAudioExtraction() {
  const { t } = useI18n();
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();
  const fileManager = useFileManager();
  const toast = useToast();

  const isExtracting = ref(false);

  async function extractAudio(entry: FsEntry) {
    if (isExtracting.value) return;
    if (!entry.path) return;

    isExtracting.value = true;
    try {
      const sourceFile = await projectStore.getFileByPath(entry.path);
      if (!sourceFile) throw new Error('Failed to access source file');

      const { client } = getExportWorkerClient();

      // Need to set host API for the worker to access files
      setExportHostApi(
        createVideoCoreHostApi({
          getCurrentProjectId: () => projectStore.currentProjectId,
          getWorkspaceHandle: () => workspaceStore.workspaceHandle,
          getResolvedStorageTopology: () => workspaceStore.resolvedStorageTopology,
          getFileHandleByPath: async (path) => projectStore.getFileHandleByPath(path),
          getFileByPath: async (path) => projectStore.getFileByPath(path),
          onExportProgress: () => {}, // Not used for extraction yet
        }),
      );

      const meta = await client.extractMetadata(sourceFile);
      if (!meta.audio) throw new Error('No audio track found in file');

      const codec = meta.audio.codec || '';
      const lowercaseCodec = codec.toLowerCase();

      let ext = 'mka';
      if (lowercaseCodec.startsWith('mp4a') || lowercaseCodec.includes('aac')) {
        ext = 'm4a';
      } else if (lowercaseCodec.includes('opus')) {
        ext = 'opus';
      } else if (lowercaseCodec.includes('mp3')) {
        ext = 'mp3';
      }

      const dirPath = entry.path.split('/').slice(0, -1).join('/');
      const baseName = entry.name.replace(/\.[^.]+$/, '');

      const dirHandle = await projectStore.getDirectoryHandleByPath(dirPath);
      if (!dirHandle) throw new Error('Target directory not found');

      let newFileName = `${baseName}_extracted.${ext}`;
      let counter = 2;

      while (true) {
        try {
          await dirHandle.getFileHandle(newFileName, { create: false });
          // If we are here, the file exists
          newFileName = `${baseName}_extracted (${counter}).${ext}`;
          counter++;
        } catch (err: any) {
          if (err.name === 'NotFoundError') {
            break;
          }
          throw err;
        }
      }

      const targetPath = dirPath ? `${dirPath}/${newFileName}` : newFileName;

      // Ensure target file is created
      await dirHandle.getFileHandle(newFileName, { create: true });

      await client.extractAudio(entry.path, targetPath);

      toast.add({
        title: t('videoEditor.fileManager.extractAudio.success', 'Audio extracted successfully'),
        color: 'success',
      });

      await fileManager.reloadDirectory(dirPath);
      const uiStore = useUiStore();
      uiStore.notifyFileManagerUpdate();
    } catch (err: any) {
      console.error('Audio extraction failed', err);
      toast.add({
        title: t('videoEditor.fileManager.extractAudio.failed', 'Failed to extract audio'),
        description: err.message,
        color: 'error',
      });
    } finally {
      isExtracting.value = false;
    }
  }

  return {
    isExtracting,
    extractAudio,
  };
}
