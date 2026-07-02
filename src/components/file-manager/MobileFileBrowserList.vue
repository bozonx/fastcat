<script setup lang="ts">
import {
  useMobileFileBrowserEntry,
  type MobileFileBrowserProps,
  type MobileFileBrowserEmit,
} from '~/composables/file-manager/useMobileFileBrowserEntry';

const props = defineProps<MobileFileBrowserProps>();
const emit = defineEmits<MobileFileBrowserEmit>();

const {
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
} = useMobileFileBrowserEntry(props, emit);
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

    <div v-else class="flex flex-col gap-2">
      <div v-for="entry in entries" :key="entry.path" class="relative group">
        <button
          class="flex items-center gap-3 w-full p-2.5 rounded-2xl bg-ui-bg-elevated border-2 transition-transform active:scale-[0.98] relative overflow-hidden"
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
          <!-- Used State Indicator -->
          <div
            v-if="isEntryUsed(entry)"
            class="absolute left-0 top-3 bottom-3 w-[3px] rounded-r-md bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)] z-10"
            aria-hidden="true"
          />

          <!-- Thumbnail / Icon Area -->
          <div
            class="relative w-12 h-12 rounded-xl bg-ui-bg flex items-center justify-center overflow-hidden shrink-0"
            :class="{ 'thumbnail-checkerboard-bg': Boolean(thumbnailsByPath[entry.path]) }"
          >
            <template v-if="isCheckingCompatibility(entry)">
              <UIcon
                name="i-heroicons-arrow-path"
                class="w-5 h-5 animate-spin text-ui-text-muted"
              />
            </template>
            <template
              v-else-if="
                getCompatibilityStatus(entry) === 'fully_unsupported' ||
                getCompatibilityStatus(entry) === 'corrupt'
              "
            >
              <div
                class="w-full h-full flex items-center justify-center bg-red-950/60 text-red-400"
              >
                <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5" />
              </div>
            </template>
            <template v-else-if="thumbnailsByPath[entry.path]">
              <img
                :src="thumbnailsByPath[entry.path]!"
                class="w-full h-full object-cover transition-transform duration-300"
                :class="{ 'scale-105 blur-[1px] opacity-70': isSelected(entry) && isSelectionMode }"
                loading="lazy"
                @error="handleImageError(entry)"
              />
            </template>
            <template v-else>
              <UIcon
                :name="getIcon(entry)"
                class="opacity-40 transition-transform"
                :class="[
                  entry.kind === 'directory' ? 'w-10 h-10 text-blue-400' : 'w-6 h-6',
                  hasProxy(entry) && !isGeneratingProxy(entry) ? 'text-(--color-success)!' : '',
                  isGeneratingProxy(entry) ? 'text-amber-400!' : '',
                  isSelected(entry) ? 'scale-110' : '',
                ]"
              />
            </template>
          </div>

          <!-- Name & Size -->
          <div class="flex-1 min-w-0 text-left flex flex-col justify-center">
            <div
              class="truncate text-xs font-semibold leading-normal mb-0.5 transition-colors"
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
              class="flex items-center gap-2 text-[10px] tabular-nums font-medium text-ui-text-muted leading-tight"
            >
              <span class="truncate max-w-[80px]">
                {{ entry.kind === 'directory' ? t('common.folder') : getFileTypeLabel(entry) }}
              </span>
              <span class="shrink-0">•</span>
              <span class="shrink-0">
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

          <div
            v-if="isSelectionMode"
            class="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ml-auto"
            :class="[
              isSelected(entry)
                ? 'bg-selection-accent-500 border-selection-accent-500 shadow-lg'
                : 'bg-black/20 border-white/40',
            ]"
          >
            <Icon v-if="isSelected(entry)" name="lucide:check" class="w-3.5 h-3.5 text-white" />
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
