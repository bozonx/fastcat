import { ref, computed, onBeforeUnmount } from 'vue';
import type { FsEntry } from '~/types/fs';
import { formatBytes } from '~/utils/format';
import { getMimeTypeFromFilename } from '~/utils/media-types';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import { useProxyStore } from '~/stores/proxy.store';
import { isGeneratingProxyInDirectory } from '~/utils/fs-entry-utils';
import { normalizeMediaCachePath } from '~/utils/media-cache-path';

export interface ExtendedFsEntry extends FsEntry {
  objectUrl?: string;
  size?: number;
}

/** Shared props contract for the mobile file-browser grid/list variants. */
export interface MobileFileBrowserProps {
  entries: ExtendedFsEntry[];
  thumbnails: Record<string, string>;
  fileCompatibility?: Record<string, FileCompatibility>;
  selectedEntryPath: string | null;
  selectedEntries: FsEntry[];
  isSelectionMode: boolean;
  isLoading?: boolean;
  error?: string | null;
  folderSizes: Record<string, number>;
}

/** Shared emits contract for the mobile file-browser grid/list variants. */
export interface MobileFileBrowserEmit {
  (e: 'entryClick' | 'entryPrimaryAction' | 'longPress' | 'toggleSelection', entry: FsEntry): void;
  (e: 'retry'): void;
}

/**
 * Shared interaction/state logic for the mobile file-browser grid and list
 * components. Both variants render different markup but use identical
 * selection, long-press, compatibility and thumbnail handling — kept here so
 * the two `.vue` files only differ in their templates.
 */
export function useMobileFileBrowserEntry(
  props: MobileFileBrowserProps,
  emit: MobileFileBrowserEmit,
) {
  const { t } = useI18n();
  const { getFileIcon } = useFileManager();
  const timelineMediaUsageStore = useTimelineMediaUsageStore();
  const proxyStore = useProxyStore();

  const mediaUsageMap = computed(() => timelineMediaUsageStore.mediaPathToTimelines);

  function isEntryUsed(entry: FsEntry) {
    if (entry.kind !== 'file' || !entry.path) return false;
    return Boolean(mediaUsageMap.value[entry.path]?.length);
  }

  function hasProxy(entry: FsEntry) {
    return (
      entry.kind === 'file' &&
      Boolean(entry.path) &&
      proxyStore.existingProxies.has(normalizeMediaCachePath(entry.path))
    );
  }

  function isGeneratingProxy(entry: FsEntry) {
    if (entry.kind === 'file') {
      return (
        Boolean(entry.path) && proxyStore.generatingProxies.has(normalizeMediaCachePath(entry.path))
      );
    }

    return isGeneratingProxyInDirectory(entry, proxyStore.generatingProxies);
  }

  const longPressTimer = ref<ReturnType<typeof setTimeout> | null>(null);
  const isLongPressActive = ref(false);
  const touchStartPos = ref({ x: 0, y: 0 });
  const isMoving = ref(false);

  function startLongPress(entry: FsEntry) {
    isLongPressActive.value = false;
    longPressTimer.value = setTimeout(() => {
      isLongPressActive.value = true;
      emit('longPress', entry);
    }, 600); // 600ms for long-press
  }

  function clearLongPress() {
    if (longPressTimer.value) {
      clearTimeout(longPressTimer.value);
      longPressTimer.value = null;
    }
  }

  function handleTouchStart(entry: FsEntry, event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;

    touchStartPos.value = { x: touch.clientX, y: touch.clientY };
    isMoving.value = false;
    startLongPress(entry);
  }

  function handleTouchMove(event: TouchEvent) {
    if (isLongPressActive.value) return;

    const touch = event.touches[0];
    if (!touch) return;

    const deltaX = Math.abs(touch.clientX - touchStartPos.value.x);
    const deltaY = Math.abs(touch.clientY - touchStartPos.value.y);

    if (deltaX > 10 || deltaY > 10) {
      isMoving.value = true;
      clearLongPress();
    }
  }

  function handleTouchEnd(entry: FsEntry, event: TouchEvent) {
    if (isLongPressActive.value) {
      event.preventDefault();
    }
    clearLongPress();
  }

  function handleClick(entry: FsEntry) {
    if (isLongPressActive.value || isMoving.value) {
      isLongPressActive.value = false;
      isMoving.value = false;
      return;
    }

    if (props.isSelectionMode) {
      emit('toggleSelection', entry);
    } else if (isCheckingCompatibility(entry)) {
      return;
    } else {
      emit('entryClick', entry);
    }
  }

  function getIcon(entry: FsEntry) {
    return getFileIcon(entry);
  }

  function getFileTypeLabel(entry: FsEntry) {
    if (entry.name.toLowerCase().endsWith('.otio')) return 'timeline/otio';
    return getMimeTypeFromFilename(entry.name);
  }

  function isSelected(entry: FsEntry) {
    if (props.isSelectionMode) {
      return props.selectedEntries.some((e) => e.path === entry.path);
    }
    return props.selectedEntryPath === entry.path;
  }

  function getCompatibilityStatus(entry: FsEntry) {
    if (!entry.path || !props.fileCompatibility) return 'ok';
    return props.fileCompatibility[entry.path]?.status ?? 'ok';
  }

  function isCheckingCompatibility(entry: FsEntry) {
    return getCompatibilityStatus(entry) === 'checking';
  }

  function getThumbnail(entry: FsEntry): string | null {
    if (entry.kind === 'directory') return null;
    const status = getCompatibilityStatus(entry);
    if (status === 'checking' || status === 'fully_unsupported' || status === 'corrupt')
      return null;
    return (
      (entry as ExtendedFsEntry).objectUrl ||
      (entry.path ? props.thumbnails[entry.path] : null) ||
      null
    );
  }

  const thumbnailsByPath = computed(() => {
    const map: Record<string, string | null> = {};
    for (const entry of props.entries) {
      map[entry.path] = getThumbnail(entry);
    }
    return map;
  });

  function handleImageError(entry: ExtendedFsEntry) {
    if (entry.objectUrl) {
      entry.objectUrl = undefined;
    }
  }

  onBeforeUnmount(clearLongPress);

  return {
    t,
    formatBytes,
    isEntryUsed,
    hasProxy,
    isGeneratingProxy,
    clearLongPress,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleClick,
    getIcon,
    getFileTypeLabel,
    isSelected,
    getCompatibilityStatus,
    isCheckingCompatibility,
    thumbnailsByPath,
    handleImageError,
  };
}
