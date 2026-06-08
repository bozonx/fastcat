import { toValue, type MaybeRefOrGetter } from 'vue';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import { useProxyStore } from '~/stores/proxy.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useClipboardPaths } from '~/composables/file-manager/useClipboardIndicator';
import type { FsEntry } from '~/types/fs';
import type { getBdPayload } from '~/types/bloggerdog';
import { WORKSPACE_COMMON_PATH_PREFIX, isWorkspaceCommonPath } from '~/utils/workspace-common';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';

export type ExtendedFsEntry = FsEntry & {
  objectUrl?: string;
  size?: number;
  mimeType?: string;
  created?: number;
};

export function getBdType(entry: FsEntry): string | undefined {
  return (entry.adapterPayload as ReturnType<typeof getBdPayload>)?.type;
}

export function getBdThumbnail(entry: FsEntry): string | undefined {
  return (entry.adapterPayload as ReturnType<typeof getBdPayload>)?.thumbnailUrl;
}

export interface UseFileBrowserEntryOptions {
  // Accept a ref/getter (not a plain snapshot): `fileCompatibility` is a parent
  // computed that returns a NEW object on each recompute. Capturing its value once
  // at setup froze it at the initial 'checking' status, so thumbnails never
  // appeared until the panel was remounted. Reading via `toValue` inside
  // `getCompatibilityStatus` keeps the render subscribed to the latest value.
  fileCompatibility?: MaybeRefOrGetter<Record<string, FileCompatibility> | undefined>;
  instanceId?: string;
}

export function useFileBrowserEntry(options: UseFileBrowserEntryOptions) {
  const selectionStore = useSelectionStore();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();
  const proxyStore = useProxyStore();
  const fileManager = useFileManager();
  const clipboardPaths = useClipboardPaths();

  function getCompatibilityStatus(entry: FsEntry) {
    const compatibility = toValue(options.fileCompatibility);
    if (!entry.path || !compatibility) return 'ok';
    return compatibility[entry.path]?.status ?? 'ok';
  }

  function isCheckingCompatibility(entry: FsEntry) {
    return getCompatibilityStatus(entry) === 'checking';
  }

  function isCutEntry(entry: FsEntry): boolean {
    return entry.path ? clipboardPaths.value.has(entry.path) : false;
  }

  function isSelected(entry: FsEntry): boolean {
    const selected = selectionStore.selectedEntity;
    if (!selected || selected.source !== 'fileManager') return false;
    if (selected.instanceId && selected.instanceId !== options.instanceId) return false;

    if (selected.kind === 'multiple') {
      return selected.entries.some((e) => e.path === entry.path);
    }
    return selected.path === entry.path;
  }

  function isWorkspaceCommonRoot(entry: FsEntry): boolean {
    return entry.kind === 'directory' && entry.path === WORKSPACE_COMMON_PATH_PREFIX;
  }

  function handleImageError(entry: ExtendedFsEntry) {
    if (entry.objectUrl) {
      entry.objectUrl = undefined;
    }
  }

  return {
    timelineMediaUsageStore,
    proxyStore,
    fileManager,
    getCompatibilityStatus,
    isCheckingCompatibility,
    isCutEntry,
    isSelected,
    isWorkspaceCommonRoot,
    handleImageError,
  };
}

export interface UseRenameTimerOptions {
  onRename: (entry: FsEntry) => void;
  canRename?: (entry: FsEntry) => boolean;
}

const RENAME_CLICK_DELAY_MS = 250;

export function useRenameTimer(options: UseRenameTimerOptions) {
  let renameTimer: ReturnType<typeof setTimeout> | null = null;

  function onNameClick(event: MouseEvent, entry: FsEntry) {
    if (!entry.path) return;
    if (isWorkspaceCommonPath(entry.path)) return;
    if (options.canRename && !options.canRename(entry)) return;
    event.stopPropagation();

    if (event.detail === 1) {
      renameTimer = setTimeout(() => {
        options.onRename(entry);
      }, RENAME_CLICK_DELAY_MS);
    }
  }

  function onNameDblClick() {
    if (renameTimer) {
      clearTimeout(renameTimer);
      renameTimer = null;
    }
  }

  return { onNameClick, onNameDblClick };
}
