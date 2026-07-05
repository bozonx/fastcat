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
                <span class="text-xs text-center font-bold leading-tight">{{
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
