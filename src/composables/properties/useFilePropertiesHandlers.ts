import { computed, type Ref, type ComputedRef } from 'vue';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { getMediaTypeFromFilename, isOpenableProjectFileName } from '~/utils/media-types';
import type { FsEntry } from '~/types/fs';

interface UseFilePropertiesHandlersOptions {
  selectedFsEntry: Ref<FsEntry | undefined | null> | ComputedRef<FsEntry | undefined | null>;
  mediaType: Ref<string | null | undefined> | ComputedRef<string | null | undefined>;
  textContent: Ref<string | null | undefined> | ComputedRef<string | null | undefined>;
  isExternalContext?: Ref<boolean> | ComputedRef<boolean>;
}

export function useFilePropertiesHandlers(options: UseFilePropertiesHandlersOptions) {
  const projectStore = useProjectStore();
  const uiStore = useUiStore();
  const { addFileTab, setActiveTab } = useProjectTabsStore();

  const hasAbsoluteLocalPath = computed(() => {
    const entry = options.selectedFsEntry.value;
    if (entry?.source === 'remote') return false;

    const path = entry?.path;
    if (typeof path !== 'string' || path.length === 0) return false;
    return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
  });

  const canOpenAsPanel = computed(() => {
    const entry = options.selectedFsEntry.value;
    if (!entry || entry.kind !== 'file') return false;
    if (options.isExternalContext?.value || hasAbsoluteLocalPath.value) return false;
    return isOpenableProjectFileName(entry.name);
  });

  const canOpenAsProjectTab = computed(() => {
    return canOpenAsPanel.value;
  });

  function openAsProjectTab() {
    const entry = options.selectedFsEntry.value;
    if (!entry || entry.kind !== 'file' || !entry.path) return;
    const type = getMediaTypeFromFilename(entry.name);
    if (type !== 'video' && type !== 'audio' && type !== 'image' && type !== 'text') return;
    const tabId = addFileTab({ filePath: entry.path, fileName: entry.name });
    setActiveTab(tabId);
  }

  function createSubfolder() {
    const entry = options.selectedFsEntry.value;
    if (!entry || entry.kind !== 'directory') return;
    uiStore.pendingFsEntryCreateFolder = entry;
  }

  function createTimelineInFolder() {
    const entry = options.selectedFsEntry.value;
    if (!entry || entry.kind !== 'directory') return;
    uiStore.pendingFsEntryCreateTimeline = entry;
  }

  function createMarkdownInFolder() {
    const entry = options.selectedFsEntry.value;
    if (!entry || entry.kind !== 'directory') return;
    uiStore.pendingFsEntryCreateMarkdown = entry;
  }

  function onRename() {
    const entry = options.selectedFsEntry.value;
    if (!entry) return;
    uiStore.pendingFsEntryRename = entry;
  }

  function onDelete() {
    const entry = options.selectedFsEntry.value;
    if (!entry) return;
    uiStore.pendingFsEntryDelete = [entry];
  }

  function openAsTextPanel(view: 'cut' | 'sound' = 'cut') {
    const entry = options.selectedFsEntry.value;
    if (!entry || entry.kind !== 'file') return;

    if (view === 'cut') {
      projectStore.goToCut();
    } else {
      projectStore.goToSound();
    }

    if (options.mediaType.value === 'text') {
      projectStore.addTextPanel(entry.path ?? entry.name, entry.name, undefined, undefined, view);
    } else if (
      options.mediaType.value === 'video' ||
      options.mediaType.value === 'audio' ||
      options.mediaType.value === 'image'
    ) {
      projectStore.addMediaPanel(
        entry,
        options.mediaType.value,
        entry.name,
        undefined,
        undefined,
        view,
      );
    }
  }

  // Removed openRemoteUploadPicker as it's not needed anymore

  return {
    canOpenAsPanel,
    canOpenAsProjectTab,
    openAsProjectTab,
    createSubfolder,
    createTimelineInFolder,
    createMarkdownInFolder,
    onRename,
    onDelete,
    openAsTextPanel,
    // openRemoteUploadPicker,
  };
}
