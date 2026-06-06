import { createDevLogger } from '~/utils/dev-logger';
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useUiStore } from '~/stores/ui.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { hasInternalFileManagerDragType } from '~/composables/file-manager/dragOperation';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  createDefaultHotkeyLookup,
  createHotkeyLookup,
  isCommandMatched,
} from '~/utils/hotkeys/runtime';
import { LARGE_UPLOAD_BACKGROUND_THRESHOLD_BYTES } from '~/file-manager/application/fileManagerCommands';
import { isTauriRuntime } from '~/utils/runtime';
import { useDraggedFile } from '~/composables/useDraggedFile';
import { useUploadProgress } from '~/composables/useUploadProgress';
import {
  getDevicePixelRatio,
  dispatchWindowEvent,
  elementFromPoint,
} from '~/utils/browser-api';
const log = createDevLogger('useGlobalDragAndDrop');

const GLOBAL_DRAG_LEAVE_HIDE_DELAY_MS = 120;

export function useGlobalDragAndDrop() {
  const isDropInProgress = ref(false);
  const isCurrentDragCancelled = ref(false);
  const uiStore = useUiStore();
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const fm = useFileManager();
  const { t } = useI18n();
  const { draggedFile } = useDraggedFile();

  const commandOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
  const effectiveHotkeys = computed(() =>
    getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys),
  );
  const hotkeyLookup = computed(() => createHotkeyLookup(effectiveHotkeys.value, commandOrder));
  const defaultHotkeyLookup = computed(() => createDefaultHotkeyLookup(commandOrder));
  const {
    isActive: isUploading,
    progress: uploadProgress,
    fileName: uploadFileName,
    phase: uploadPhase,
    begin: beginUpload,
    end: endUpload,
    cancel: cancelUpload,
    onProgress: onUploadProgress,
  } = useUploadProgress();

  let globalDragLeaveTimeout: number | null = null;

  function cancelGlobalDragLeaveTimeout() {
    if (globalDragLeaveTimeout === null) return;
    window.clearTimeout(globalDragLeaveTimeout);
    globalDragLeaveTimeout = null;
  }

  function showGlobalDragOverlay() {
    cancelGlobalDragLeaveTimeout();
    uiStore.isGlobalDragging = true;
  }

  function hideGlobalDragOverlay() {
    cancelGlobalDragLeaveTimeout();
    uiStore.isGlobalDragging = false;
  }

  function scheduleGlobalDragOverlayHide() {
    cancelGlobalDragLeaveTimeout();
    globalDragLeaveTimeout = window.setTimeout(() => {
      uiStore.isGlobalDragging = false;
      isCurrentDragCancelled.value = false;
      globalDragLeaveTimeout = null;
    }, GLOBAL_DRAG_LEAVE_HIDE_DELAY_MS);
  }

  function shouldUseBackgroundTask(files: File[]) {
    const totalBytes = files.reduce((acc, file) => acc + file.size, 0);
    return totalBytes >= LARGE_UPLOAD_BACKGROUND_THRESHOLD_BYTES;
  }

  async function handleDroppedFiles(files: File[], targetDirPath?: string) {
    if (isDropInProgress.value) return;
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

    const useBackgroundTask = shouldUseBackgroundTask(files);

    isDropInProgress.value = true;
    const abortSignal = beginUpload(
      t('videoEditor.fileManager.actions.importing'),
      useBackgroundTask,
    );
    const fallbackBytes = files.reduce((acc, file) => acc + file.size, 0);

    try {
      await fm.handleFiles(files, {
        targetDirPath,
        abortSignal,
        backgroundMode: useBackgroundTask ? 'auto' : 'never',
        onProgress: (p) => onUploadProgress(p, fallbackBytes),
      });
      isCurrentDragCancelled.value = false;
    } finally {
      isDropInProgress.value = false;
      endUpload();
    }
  }

  function onGlobalKeyDown(e: KeyboardEvent) {
    if (!uiStore.isGlobalDragging) return;

    const isCancel = isCommandMatched({
      event: e,
      cmdId: 'general.deselect',
      userSettings: workspaceStore.userSettings,
      hotkeyLookup: hotkeyLookup.value,
      defaultHotkeyLookup: defaultHotkeyLookup.value,
    });

    if (isCancel) {
      hideGlobalDragOverlay();
      isCurrentDragCancelled.value = true;
      // Note: We can't cancel the actual OS drag, but we reset our UI state
      // and stop appearing as a drop target until the user leaves the window
    }
  }

  // Web Drop
  function onGlobalDragOver(e: DragEvent) {
    if (isCurrentDragCancelled.value) return;
    if (uiStore.isFileManagerDragging) return;

    const types = e.dataTransfer?.types;
    if (!types) return;

    const typesArr = Array.from(types);
    if (hasInternalFileManagerDragType(typesArr)) return;

    if (typesArr.includes('Files')) {
      e.preventDefault();
      showGlobalDragOverlay();
    }
  }

  function onGlobalDragLeave(e: DragEvent) {
    if (!e.relatedTarget) {
      scheduleGlobalDragOverlayHide();
    }
  }

  /**
   * Handles auto-sorted file drop (no specific folder target).
   * The overlay intercepts drops to specific folders via events.
   */
  async function handleAutoFileDrop(files: File[]) {
    await handleDroppedFiles(files);
  }

  /**
   * Handles file drop to specific folder.
   */
  async function handleFolderFileDrop(files: File[], targetDirPath: string) {
    await handleDroppedFiles(files, targetDirPath);
  }

  async function onGlobalDrop(e: DragEvent) {
    // The overlay handles drops via its own events, so the global drop
    // is only for fallback when overlay is not shown
    if (isDropInProgress.value) return;
    if (uiStore.isFileManagerDragging || hasInternalFileManagerDragType(e.dataTransfer?.types)) {
      hideGlobalDragOverlay();
      return;
    }

    try {
      hideGlobalDragOverlay();
      isCurrentDragCancelled.value = false;

      const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
      if (files.length === 0) return;
      await handleDroppedFiles(files);
    } finally {
      hideGlobalDragOverlay();
    }
  }

  // Tauri Drop
  let unlistenTauriDrop: (() => void) | undefined;
  let isTauriNativeInternalDrag = false;
  let tauriNativeInternalDragPayload: unknown = null;

  function dispatchTauriDragOver(position: { x: number; y: number }) {
    const scale = getDevicePixelRatio();
    dispatchWindowEvent(
      new CustomEvent('fastcat:tauri-drag-over', {
        detail: {
          clientX: position.x / scale,
          clientY: position.y / scale,
        },
      }),
    );
  }

  function dispatchTauriDragLeave() {
    dispatchWindowEvent(new CustomEvent('fastcat:tauri-drag-leave'));
  }

  function dispatchTauriInternalFileDrop(position: { x: number; y: number } | undefined) {
    const payload = draggedFile.value ?? tauriNativeInternalDragPayload;
    if (!payload || !position) return;

    const scale = getDevicePixelRatio();
    dispatchWindowEvent(
      new CustomEvent('fastcat:tauri-internal-file-drop', {
        detail: {
          clientX: position.x / scale,
          clientY: position.y / scale,
          payload,
        },
      }),
    );
  }

  onMounted(async () => {
    window.addEventListener('keydown', onGlobalKeyDown, { capture: true });

    if (isTauriRuntime()) {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        unlistenTauriDrop = await getCurrentWebview().onDragDropEvent(async (event) => {
          const hasActiveInternalDrag = uiStore.isFileManagerDragging || Boolean(draggedFile.value);

          if (event.payload.type === 'over') {
            if (hasActiveInternalDrag) {
              isTauriNativeInternalDrag = true;
              tauriNativeInternalDragPayload = draggedFile.value ?? tauriNativeInternalDragPayload;
              hideGlobalDragOverlay();
            } else {
              showGlobalDragOverlay();
              if (event.payload.position) {
                dispatchTauriDragOver(event.payload.position);
              }
            }
          } else if (event.payload.type === 'leave') {
            scheduleGlobalDragOverlayHide();
            dispatchTauriDragLeave();
            isTauriNativeInternalDrag = false;
            tauriNativeInternalDragPayload = null;
          } else if (event.payload.type === 'drop') {
            hideGlobalDragOverlay();

            if (hasActiveInternalDrag || isTauriNativeInternalDrag) {
              dispatchTauriInternalFileDrop(event.payload.position);
              isTauriNativeInternalDrag = false;
              tauriNativeInternalDragPayload = null;
              return;
            }

            if (isDropInProgress.value) return;
            if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

            // Detect target folder from drop position before DOM is updated
            let targetDirPath: string | undefined;
            try {
              if (event.payload.position) {
                const scale = getDevicePixelRatio();
                const x = event.payload.position.x / scale;
                const y = event.payload.position.y / scale;
                const el = elementFromPoint(x, y);
                const folderEl = el?.closest('[data-folder-path]');
                targetDirPath = folderEl?.getAttribute('data-folder-path') || undefined;
              }
            } catch (e) {
              log.warn('Failed to detect drop target folder from position', e);
            }

            isDropInProgress.value = true;
            try {
              const paths = event.payload.paths || [];
              if (paths.length === 0) return;

              const files: File[] = [];

              const { invoke } = await import('@tauri-apps/api/core');
              for (const rawPath of paths) {
                // Внутренний drag (blob:/http:/data:) — забираем содержимое через fetch,
                // потому что это не путь в FS.
                if (/^(blob|https?|data):/i.test(rawPath)) {
                  try {
                    const resp = await fetch(rawPath);
                    const blob = await resp.blob();
                    // Имя файла собираем так, чтобы расширение реально соответствовало контенту:
                    // у blob:/data: URL имя в path может быть UUID без расширения, тогда оно
                    // попадает в `_files` вместо `_images`/`_video` и затем падает на VFS-записи.
                    const lastSegment = rawPath.split('/').pop()?.split('?')[0] || '';
                    const hasExt = /\.[a-z0-9]+$/i.test(lastSegment);
                    const mimeExt = (blob.type.split('/')[1] || '').replace(/[^a-z0-9]/gi, '');
                    let filename: string;
                    if (hasExt) {
                      filename = lastSegment;
                    } else if (mimeExt) {
                      const base = lastSegment || `dropped-${Date.now()}`;
                      filename = `${base}.${mimeExt === 'jpeg' ? 'jpg' : mimeExt}`;
                    } else {
                      filename = lastSegment || `dropped-${Date.now()}.bin`;
                    }
                    files.push(
                      new File([blob], filename, {
                        type: blob.type || 'application/octet-stream',
                        lastModified: Date.now(),
                      }),
                    );
                  } catch (err) {
                    log.warn('Failed to fetch blob/url drop', rawPath, err);
                  }
                  continue;
                }

                // Tauri иногда отдаёт `file://...` URL вместо plain path (зависит от source);
                // tauri-plugin-fs не любит non-file URL'ы — конвертим обратно в OS-путь.
                let path = rawPath;
                if (/^file:\/\//i.test(path)) {
                  try {
                    path = decodeURIComponent(new URL(path).pathname);
                  } catch {
                    log.warn('Failed to decode file:// URL, using as-is', rawPath);
                  }
                }

                // Extend scope to allow reading the dropped file from any location.
                await invoke('allow_dropped_file_scope', { path }).catch((err) => {
                  log.warn('allow_dropped_file_scope failed', path, err);
                });

                let file: File | null = null;
                try {
                  file = await fm.vfs.getFile(path);
                } catch {
                  // absolute OS path outside VFS workspace scope — fall through to direct read
                }

                if (file) {
                  files.push(file);
                } else {
                  const { readFile, stat } = await import('@tauri-apps/plugin-fs');
                  let metadata;
                  let bytes;
                  try {
                    metadata = await stat(path);
                    bytes = await readFile(path);
                  } catch (err) {
                    log.warn('Failed to read dropped file via fs plugin', path, err);
                    continue;
                  }
                  const filename = path.split(/[/\\]/).pop() || 'unknown';
                  files.push(
                    new File([bytes], filename, {
                      lastModified: metadata.mtime
                        ? new Date(metadata.mtime).getTime()
                        : Date.now(),
                    }),
                  );
                }
              }

              if (files.length > 0) {
                await fm.handleFiles(files, targetDirPath ? { targetDirPath } : undefined);
              }
            } catch (err) {
              log.error('Failed to handle Tauri file drop:', err);
            } finally {
              isDropInProgress.value = false;
            }
          }
        });
      } catch (err) {
        log.error('Failed to setup Tauri drop listener:', err);
      }
    }
  });

  onUnmounted(() => {
    cancelGlobalDragLeaveTimeout();
    window.removeEventListener('keydown', onGlobalKeyDown, { capture: true });

    if (unlistenTauriDrop) {
      unlistenTauriDrop();
    }
  });

  return {
    onGlobalDragOver,
    onGlobalDragLeave,
    onGlobalDrop,
    handleAutoFileDrop,
    handleFolderFileDrop,
    isUploading,
    uploadProgress,
    uploadFileName,
    uploadPhase,
    cancelUpload,
  };
}
