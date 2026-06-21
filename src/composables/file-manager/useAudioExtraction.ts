import { createDevLogger } from '~/utils/dev-logger';
import { computed, inject, nextTick } from 'vue';
import type { FsEntry } from '~/types/fs';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useAudioExtractionCore } from '~/composables/file-manager/useAudioExtractionCore';
const log = createDevLogger('useAudioExtraction');

interface AudioExtractionSelectionContext {
  instanceId?: string;
  isExternal?: boolean;
}

export function useAudioExtraction() {
  const { t } = useI18n();
  const projectStore = useProjectStore();
  const fileManager = useFileManager();
  const toast = useToast();
  const selectionStore = useSelectionStore();
  const uiStore = useUiStore();
  const { extractAudioFile } = useAudioExtractionCore();

  // Resolve the correct file manager store for the current context.
  // ComputerFileManager injects its own sidebar store; other contexts use the global one.
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ??
    useFileManagerStore();

  const isExtracting = computed({
    get: () => uiStore.isExtractingAudio,
    set: (val) => {
      uiStore.isExtractingAudio = val;
      if (!val) {
        uiStore.extractingAudioError = null;
      }
    },
  });

  async function extractAudio(entry: FsEntry, context: AudioExtractionSelectionContext = {}) {
    if (isExtracting.value) return;
    if (!entry.path) return;

    uiStore.extractingAudioError = null;
    isExtracting.value = true;
    try {
      const selectedEntityBeforeNavigation = selectionStore.selectedEntity;
      const selectionContext = {
        instanceId:
          context.instanceId ??
          (selectedEntityBeforeNavigation?.source === 'fileManager'
            ? selectedEntityBeforeNavigation.instanceId
            : undefined),
        isExternal:
          context.isExternal ??
          (selectedEntityBeforeNavigation?.source === 'fileManager'
            ? selectedEntityBeforeNavigation.isExternal
            : undefined),
      };
      const isExternal = context.isExternal === true;

      const result = await extractAudioFile(entry, {
        isExternal,
        taskIdPrefix: `audio-extract-${Date.now()}`,
      });

      if (!result) return;
      if (result.status === 'no-audio') {
        toast.add({
          title: t('videoEditor.fileManager.extractAudio.noAudioTrack'),
          color: 'warning',
        });
        return;
      }

      const { targetPath, newFileName, dirPath } = result;

      toast.add({
        title: t('videoEditor.fileManager.extractAudio.success'),
        color: 'success',
      });

      // Expand the parent directory in the tree view before reloading
      if (dirPath) {
        uiStore.setFileTreePathExpanded(dirPath, true);
      }

      await fileManager.reloadDirectory(dirPath);

      // Navigate the flat file browser to the directory containing the new file
      const folderEntry: FsEntry = {
        kind: 'directory',
        path: dirPath,
        name: dirPath
          ? (dirPath.split('/').pop() ?? dirPath)
          : (projectStore.currentProjectName ?? '/'),
        parentPath: dirPath ? dirPath.split('/').slice(0, -1).join('/') || undefined : undefined,
      };
      fileManagerStore.openFolder(folderEntry, {
        skipHistory: !dirPath,
        selectionContext,
      });

      uiStore.notifyFileManagerUpdate();
      await nextTick();

      const newEntry =
        fileManager.findEntryByPath(targetPath) ??
        (await fileManager.resolveEntryByPath(targetPath)) ??
        ({
          kind: 'file',
          name: newFileName,
          path: targetPath,
          parentPath: dirPath || undefined,
          source: entry.source ?? 'local',
        } as FsEntry);

      selectionStore.selectFsEntryWithUiUpdate(
        newEntry,
        selectionContext.instanceId,
        selectionContext.isExternal,
      );
      if (typeof fileManagerStore.selectItem === 'function') {
        fileManagerStore.selectItem(newEntry, selectionContext);
      }

      // Scroll the tree view to make the new entry visible
      uiStore.triggerScrollToFileTreeEntry(targetPath);
    } catch (err: unknown) {
      log.error('Audio extraction failed', err);
      const e = err instanceof Error ? err : null;
      uiStore.extractingAudioError = e?.message ?? 'Unknown error';
      toast.add({
        title: t('videoEditor.fileManager.extractAudio.failed'),
        description: e?.message ?? 'Unknown error',
        color: 'error',
      });
    } finally {
      if (!uiStore.extractingAudioError) {
        isExtracting.value = false;
      }
    }
  }

  return {
    isExtracting,
    extractAudio,
  };
}
