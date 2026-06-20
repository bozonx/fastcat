<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';
import type { FsEntry } from '~/types/fs';
import { formatBytes } from '~/utils/format';
import { getMimeTypeFromFilename } from '~/utils/media-types';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';
import type { FileCompatibility } from '~/composables/file-manager/useFileManagerCompatibility';
import { useProxyStore } from '~/stores/proxy.store';
import { isGeneratingProxyInDirectory } from '~/utils/fs-entry-utils';
import { normalizeMediaCachePath } from '~/utils/media-cache-path';

interface ExtendedFsEntry extends FsEntry {
  objectUrl?: string;
  size?: number;
}

const props = defineProps<{
  entries: ExtendedFsEntry[];
  thumbnails: Record<string, string>;
  fileCompatibility?: Record<string, FileCompatibility>;
  selectedEntryPath: string | null;
  selectedEntries: FsEntry[];
  isSelectionMode: boolean;
  isLoading?: boolean;
  error?: string | null;
  folderSizes: Record<string, number>;
}>();

const emit = defineEmits<{
  (e: 'entryClick' | 'entryPrimaryAction' | 'longPress' | 'toggleSelection', entry: FsEntry): void;
  (e: 'retry'): void;
}>();

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
  if (status === 'checking' || status === 'fully_unsupported' || status === 'corrupt') return null;
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
</script>

<template>
  <div class="p-3">
    <div v-if="isLoading" class="flex h-32 items-center justify-center">
      <Icon name="lucide:loader-2" class="w-6 h-6 animate-spin text-blue-500" />
    </div>

    <div
      v-else-if="props.error"
      class="flex flex-col items-center justify-center h-64 px-6 text-center"
    >
      <div
        class="rounded-2xl border border-red-500/20 bg-red-500/10 p-5 text-red-200 max-w-sm mb-4"
      >
        <Icon name="lucide:alert-circle" class="w-8 h-8 mb-2 mx-auto text-red-400" />
        <p class="text-sm font-semibold">{{ t('common.error') }}</p>
        <p class="mt-2 text-xs text-red-200/80">{{ props.error }}</p>
      </div>
      <UButton
        color="neutral"
        variant="soft"
        icon="lucide:arrow-path"
        :label="t('common.retry')"
        @click="emit('retry')"
      />
    </div>

    <div
      v-else-if="entries.length === 0"
      class="flex flex-col items-center justify-center h-64 opacity-30 px-6 text-center"
    >
      <Icon name="lucide:folder-open" class="w-12 h-12 mb-2" />
      <p class="text-sm">
        {{ t('videoEditor.fileManager.empty') }}
      </p>
    </div>

    <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
      <div v-for="entry in entries" :key="entry.path" class="relative group">
        <button
          class="flex flex-col w-full aspect-square rounded-2xl overflow-hidden bg-ui-bg-elevated border-2 transition-transform active:scale-95"
          :class="[
            isSelected(entry)
              ? 'border-selection-accent-500 ring-2 ring-selection-accent-500/20 shadow-[0_0_15px_rgba(59,130,246,0.3)]'
              : 'border-transparent hover:border-ui-border',
          ]"
          @touchstart="handleTouchStart(entry, $event)"
          @touchmove="handleTouchMove($event)"
          @touchend="handleTouchEnd(entry, $event)"
          @touchcancel="clearLongPress"
          @click="handleClick(entry)"
        >
          <!-- Thumbnail / Icon Area -->
          <div
            class="relative flex-1 w-full bg-ui-bg flex items-center justify-center overflow-hidden"
          >
            <template v-if="isCheckingCompatibility(entry)">
              <div
                class="w-full h-full flex items-center justify-center text-ui-text-muted"
                :title="t('videoEditor.fileManager.compatibility.checking')"
              >
                <UIcon name="i-heroicons-arrow-path" class="w-6 h-6 animate-spin" />
              </div>
            </template>
            <template
              v-else-if="
                getCompatibilityStatus(entry) === 'fully_unsupported' ||
                getCompatibilityStatus(entry) === 'corrupt'
              "
            >
              <div
                class="w-full h-full flex flex-col items-center justify-center bg-red-950/60 text-red-400 gap-1 p-1"
              >
                <UIcon name="i-heroicons-exclamation-triangle" class="w-6 h-6 shrink-0" />
                <span class="text-xs text-center font-bold leading-tight uppercase">{{
                  getCompatibilityStatus(entry) === 'corrupt'
                    ? t('videoEditor.fileManager.compatibility.corrupt')
                    : t('videoEditor.fileManager.compatibility.unsupported')
                }}</span>
              </div>
            </template>
            <template v-else-if="thumbnailsByPath[entry.path]">
              <img
                :src="thumbnailsByPath[entry.path]!"
                class="w-full h-full object-contain transition-transform duration-300"
                :class="{ 'scale-110 blur-[1px] opacity-70': isSelected(entry) && isSelectionMode }"
                loading="lazy"
                @error="handleImageError(entry)"
              />
            </template>
            <template v-else>
              <UIcon
                :name="getIcon(entry)"
                class="opacity-40 transition-transform"
                :class="[
                  entry.kind === 'directory' ? 'w-32 h-32 text-blue-400' : 'w-10 h-10',
                  hasProxy(entry) && !isGeneratingProxy(entry) ? 'text-(--color-success)!' : '',
                  isGeneratingProxy(entry) ? 'text-amber-400!' : '',
                  isSelected(entry) ? 'scale-110' : '',
                ]"
              />
            </template>

            <div
              v-if="isSelectionMode"
              class="absolute top-2 left-2 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all"
              :class="[
                isSelected(entry)
                  ? 'bg-selection-accent-500 border-selection-accent-500 shadow-lg'
                  : 'bg-black/20 border-white/40',
              ]"
            >
              <Icon v-if="isSelected(entry)" name="lucide:check" class="w-4 h-4 text-white" />
            </div>

            <!-- Used State Indicator -->
            <div
              v-if="isEntryUsed(entry)"
              class="absolute bottom-0 left-0 right-0 h-[2px] bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)] z-10"
              aria-hidden="true"
            />
          </div>

          <!-- Name & Size -->
          <div
            class="px-2.5 py-2 bg-ui-bg-elevated/90 backdrop-blur-sm border-t border-ui-border/50"
          >
            <div
              class="truncate text-[12px] font-medium leading-tight mb-0.5 transition-colors"
              :title="entry.name"
              :class="[
                isSelected(entry) && !hasProxy(entry) && !isGeneratingProxy(entry)
                  ? 'text-selection-accent-400'
                  : '',
                hasProxy(entry) && !isGeneratingProxy(entry) ? 'text-(--color-success)!' : '',
                isGeneratingProxy(entry) ? 'text-amber-400!' : '',
                getCompatibilityStatus(entry) !== 'ok' &&
                getCompatibilityStatus(entry) !== 'checking'
                  ? 'text-red-400!'
                  : '',
              ]"
            >
              {{ entry.name }}
            </div>
            <div
              class="flex items-center justify-between opacity-80 text-[10px] tabular-nums mt-0.5 font-medium"
            >
              <span class="truncate pr-2 text-ui-text-muted">
                {{ entry.kind === 'directory' ? t('common.folder') : getFileTypeLabel(entry) }}
              </span>
              <span class="shrink-0 text-ui-text-muted">
                {{
                  entry.kind === 'directory'
                    ? props.folderSizes[entry.path] !== undefined
                      ? formatBytes(props.folderSizes[entry.path]!)
                      : '...'
                    : formatBytes(entry.size || 0)
                }}
              </span>
            </div>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
