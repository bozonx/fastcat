import { ref, computed, onMounted, onUnmounted, inject } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  createDefaultHotkeyLookup,
  createHotkeyLookup,
  isCommandMatched,
} from '~/utils/hotkeys/runtime';
import { useFileDrop } from '~/composables/file-manager/useFileDrop';
import {
  FILE_MANAGER_COPY_DRAG_TYPE,
  useDraggedFile,
  FILE_MANAGER_MOVE_DRAG_TYPE,
  INTERNAL_DRAG_TYPE,
} from '~/composables/useDraggedFile';
import type { FsEntry } from '~/types/fs';
import type { DraggedFileData } from '~/composables/useDraggedFile';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { resolveFileManagerDragOperation } from '~/composables/file-manager/dragOperation';

interface UseFileBrowserDragAndDropOptions {
  findEntryByPath: (path: string) => FsEntry | null;
  resolveEntryByPath: (path: string) => Promise<FsEntry | null>;
  handleFiles: (files: File[] | FileList, targetDirPath?: string) => Promise<void>;
  moveEntry: (params: { source: FsEntry; targetDirPath: string }) => Promise<void>;
  copyEntry: (params: { source: FsEntry; targetDirPath: string }) => Promise<unknown>;
  loadFolderContent: () => Promise<void>;
  notifyFileManagerUpdate: () => void;
  fileManagerInstanceId?: string | null;
}

export function useFileBrowserDragAndDrop(options: UseFileBrowserDragAndDropOptions) {
  const uiStore = useUiStore();
  const workspaceStore = useWorkspaceStore();
  const fileManagerStore =
    (inject('fileManagerStore', null) as ReturnType<typeof useFileManagerStore> | null) ||
    useFileManagerStore();

  const commandOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
  const effectiveHotkeys = computed(() =>
    getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys),
  );
  const hotkeyLookup = computed(() => createHotkeyLookup(effectiveHotkeys.value, commandOrder));
  const defaultHotkeyLookup = computed(() => createDefaultHotkeyLookup(commandOrder));

  function onGlobalKeyDown(e: KeyboardEvent) {
    if (!uiStore.isFileManagerDragging) return;

    const isCancel = isCommandMatched({
      event: e,
      cmdId: 'general.deselect',
      userSettings: workspaceStore.userSettings,
      hotkeyLookup: hotkeyLookup.value,
      defaultHotkeyLookup: defaultHotkeyLookup.value,
    });

    if (isCancel) {
      uiStore.isFileManagerDragging = false;
      onEntryDragEnd();
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', onGlobalKeyDown, { capture: true });
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', onGlobalKeyDown, { capture: true });
  });
  const { setDraggedFile, clearDraggedFile } = useDraggedFile();
  const {
    currentDragOperation,
    dragSourceFileManagerInstanceId,
    setCurrentDragOperation,
    setDragSourceFileManagerInstanceId,
  } = useAppClipboard();

  const isDragOverPanel = ref(false);
  const dragOverEntryPath = ref<string | null>(null);

  // Local drag counter per entry path to prevent flickering during dragover/dragleave
  const entryDragCounters = new Map<string, number>();
  // Local drag counter for the panel itself
  let panelDragEnterCount = 0;

  const {
    isRootDropOver,
    isRelevantDrag,
    onRootDragEnter,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
  } = useFileDrop({
    resolveEntryByPath: options.resolveEntryByPath,
    handleFiles: options.handleFiles,
    moveEntry: options.moveEntry,
    copyEntry: options.copyEntry,
    targetFileManagerInstanceId: options.fileManagerInstanceId ?? null,
  });

  function isCopyModifierActive(event: DragEvent): boolean {
    return isLayer1Active(event, workspaceStore.userSettings);
  }

  function resolveDragOperation(event: DragEvent): 'copy' | 'move' {
    return resolveFileManagerDragOperation({
      dragSourceFileManagerInstanceId,
      isLayer1Active: isCopyModifierActive(event),
      targetFileManagerInstanceId: options.fileManagerInstanceId ?? null,
    });
  }

  function resolveDragStartOperation(event: DragEvent): 'copy' | 'move' {
    return isCopyModifierActive(event) ? 'copy' : 'move';
  }

  function onEntryDragStart(e: DragEvent, entry: FsEntry) {
    if (!entry.path) return;
    if (!e.dataTransfer) return;

    const selectionStore = useSelectionStore();
    const selected = selectionStore.selectedEntity;

    let entriesToMove: FsEntry[] = [entry];

    // If dragging an already selected item, move the whole selection
    if (selected?.source === 'fileManager') {
      if (selected.kind === 'multiple') {
        const isSelected = selected.entries.some((s) => s.path === entry.path);
        if (isSelected) {
          entriesToMove = selected.entries;
        }
      }
    }

    e.dataTransfer.effectAllowed = 'copyMove';

    const operation = resolveDragStartOperation(e);
    setDragSourceFileManagerInstanceId(options.fileManagerInstanceId ?? null);
    setCurrentDragOperation(operation);

    const movePayload = entriesToMove.map((e) => ({ name: e.name, kind: e.kind, path: e.path }));
    e.dataTransfer.setData(
      operation === 'copy' ? FILE_MANAGER_COPY_DRAG_TYPE : FILE_MANAGER_MOVE_DRAG_TYPE,
      JSON.stringify(movePayload),
    );
    // Mark as internal so the global overlay is not shown
    e.dataTransfer?.setData(INTERNAL_DRAG_TYPE, '1');

    if (entry.kind !== 'file') return;

    // Set preview for the primary dragged item
    const isTimeline = entry.name.toLowerCase().endsWith('.otio');
    const kind: DraggedFileData['kind'] = isTimeline ? 'timeline' : 'file';
    const data: DraggedFileData = {
      name: entry.name,
      kind,
      path: entry.path,
      operation,
      count: entriesToMove.length > 1 ? entriesToMove.length : undefined,
      items: movePayload,
    };
    setDraggedFile(data);
    uiStore.isFileManagerDragging = true;
    e.dataTransfer?.setData('application/json', JSON.stringify(data));
  }

  function onEntryDragEnd() {
    clearDraggedFile();
    uiStore.isFileManagerDragging = false;
    setCurrentDragOperation(null);
    setDragSourceFileManagerInstanceId(null);
    dragOverEntryPath.value = null;
  }

  function isDropTargetDir(entry: FsEntry): boolean {
    return entry.kind === 'directory';
  }

  function onEntryDragEnter(e: DragEvent, entry: FsEntry) {
    if (!isDropTargetDir(entry)) return;
    if (!e.dataTransfer?.types) return;

    const types = e.dataTransfer.types;
    if (
      !types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) &&
      !types.includes(FILE_MANAGER_COPY_DRAG_TYPE) &&
      !types.includes('Files')
    ) {
      return;
    }

    e.preventDefault();
    const path = entry.path ?? '';
    const count = (entryDragCounters.get(path) || 0) + 1;
    entryDragCounters.set(path, count);
    dragOverEntryPath.value = path;
  }

  function onEntryDragOver(e: DragEvent, entry: FsEntry) {
    if (!isDropTargetDir(entry)) return;
    const types = e.dataTransfer?.types;
    if (!types) return;
    if (
      !types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) &&
      !types.includes(FILE_MANAGER_COPY_DRAG_TYPE) &&
      !types.includes('Files')
    ) {
      return;
    }
    if (
      types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      types.includes(FILE_MANAGER_COPY_DRAG_TYPE)
    ) {
      setCurrentDragOperation(resolveDragOperation(e));
    }
    dragOverEntryPath.value = entry.path ?? null;
    const operation = types.includes('Files') ? 'copy' : resolveDragOperation(e);
    e.dataTransfer!.dropEffect = operation === 'copy' ? 'copy' : 'move';
  }

  function onEntryDragLeave(e: DragEvent, entry: FsEntry) {
    const path = entry.path ?? '';
    if (dragOverEntryPath.value !== path) return;

    const count = (entryDragCounters.get(path) || 0) - 1;
    if (count <= 0) {
      entryDragCounters.delete(path);
      if (dragOverEntryPath.value === path) {
        dragOverEntryPath.value = null;
      }
    } else {
      entryDragCounters.set(path, count);
    }
  }

  async function onEntryDrop(e: DragEvent, entry: FsEntry) {
    if (!isDropTargetDir(entry)) return;
    e.stopPropagation();

    const path = entry.path ?? '';
    entryDragCounters.delete(path);
    dragOverEntryPath.value = null;

    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    const hasFiles = e.dataTransfer?.types.includes('Files') ?? false;
    const copyRaw = e.dataTransfer?.getData(FILE_MANAGER_COPY_DRAG_TYPE);
    const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);

    const targetPath = entry.path;

    const internalRaw = copyRaw || moveRaw;
    if (internalRaw) {
      const shouldCopy = resolveDragOperation(e) === 'copy' || currentDragOperation === 'copy';
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(internalRaw);
      } catch (err) {
        console.warn(
          '[useFileBrowserDragAndDrop] Failed to parse internal drag data on entry:',
          err,
        );
        return;
      }

      const itemsToMove = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of itemsToMove) {
        const sourcePath = typeof item?.path === 'string' ? item.path : '';
        if (!sourcePath || sourcePath === targetPath) continue;

        const source = await options.resolveEntryByPath(sourcePath);
        if (!source) continue;

        if (shouldCopy) {
          await options.copyEntry({
            source,
            targetDirPath: targetPath,
          });
        } else {
          await options.moveEntry({
            source,
            targetDirPath: targetPath,
          });
        }
      }

      options.notifyFileManagerUpdate();
      await options.loadFolderContent();
      return;
    }

    if (!hasFiles || droppedFiles.length === 0) return;

    await options.handleFiles(droppedFiles, targetPath);
    options.notifyFileManagerUpdate();
    await options.loadFolderContent();
  }

  function onPanelDragEnter(e: DragEvent) {
    const types = e.dataTransfer?.types;
    if (!types) return;
    if (
      types.includes('Files') ||
      types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      types.includes(FILE_MANAGER_COPY_DRAG_TYPE)
    ) {
      e.preventDefault();
      panelDragEnterCount++;
      isDragOverPanel.value = true;
    }
  }

  function onPanelDragOver(e: DragEvent) {
    const types = e.dataTransfer?.types;
    if (!types) return;
    if (
      types.includes('Files') ||
      types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      types.includes(FILE_MANAGER_COPY_DRAG_TYPE)
    ) {
      isDragOverPanel.value = true;
      if (
        types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
        types.includes(FILE_MANAGER_COPY_DRAG_TYPE)
      ) {
        setCurrentDragOperation(resolveDragOperation(e));
      }
      const operation = types.includes('Files') ? 'copy' : resolveDragOperation(e);
      e.dataTransfer!.dropEffect = operation === 'copy' ? 'copy' : 'move';
    }
  }

  function onPanelDragLeave(e: DragEvent) {
    const types = e.dataTransfer?.types;
    if (!types) return;
    if (
      types.includes('Files') ||
      types.includes(FILE_MANAGER_MOVE_DRAG_TYPE) ||
      types.includes(FILE_MANAGER_COPY_DRAG_TYPE)
    ) {
      panelDragEnterCount--;
      if (panelDragEnterCount <= 0) {
        panelDragEnterCount = 0;
        isDragOverPanel.value = false;
      }
    }
  }

  async function onPanelDrop(e: DragEvent) {
    panelDragEnterCount = 0;
    isDragOverPanel.value = false;

    const targetFolder = fileManagerStore.selectedFolder;
    const targetPath = targetFolder?.path ?? '';

    const copyRaw = e.dataTransfer?.getData(FILE_MANAGER_COPY_DRAG_TYPE);
    const moveRaw = e.dataTransfer?.getData(FILE_MANAGER_MOVE_DRAG_TYPE);
    const internalRaw = copyRaw || moveRaw;
    if (internalRaw) {
      const shouldCopy = resolveDragOperation(e) === 'copy' || currentDragOperation === 'copy';
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(internalRaw);
      } catch (err) {
        console.warn(
          '[useFileBrowserDragAndDrop] Failed to parse internal drag data on panel:',
          err,
        );
        return;
      }

      const itemsToMove = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of itemsToMove) {
        const sourcePath = typeof item?.path === 'string' ? item.path : '';
        if (!sourcePath) continue;

        const source = await options.resolveEntryByPath(sourcePath);
        if (!source) continue;

        if (shouldCopy) {
          await options.copyEntry({
            source,
            targetDirPath: targetPath,
          });
        } else {
          await options.moveEntry({
            source,
            targetDirPath: targetPath,
          });
        }
      }

      options.notifyFileManagerUpdate();
      await options.loadFolderContent();
      return;
    }

    const droppedFiles = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
    if (droppedFiles.length === 0) return;

    await options.handleFiles(droppedFiles, targetPath);
    options.notifyFileManagerUpdate();
    await options.loadFolderContent();
  }

  return {
    isDragOverPanel,
    dragOverEntryPath,
    currentDragOperation,
    isRootDropOver,
    isRelevantDrag,
    onEntryDragStart,
    onEntryDragEnd,
    onEntryDragEnter,
    onEntryDragOver,
    onEntryDragLeave,
    onEntryDrop,
    onRootDragEnter,
    onRootDragOver,
    onRootDragLeave,
    onRootDrop,
    onPanelDragEnter,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
  };
}
