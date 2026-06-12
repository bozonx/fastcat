<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useHistoryStore } from '~/stores/history.store';

// Import useFileManager here to avoid circular dependencies if any,
// though it should be fine as it's a composable.
import { useFileManager } from '~/composables/file-manager/useFileManager';

defineProps<{
  compact?: boolean;
  mobile?: boolean;
}>();

const { locale } = useI18n();
const timelineStore = useTimelineStore();
const historyStore = useHistoryStore();

const past = computed(() => historyStore.past);
const future = computed(() => historyStore.future);

const { restoreHistory } = useFileManager();

const canUndo = computed(() => historyStore.canUndo());
const canRedo = computed(() => historyStore.canRedo());

const reversedPast = computed(() => [...past.value].reverse());
const reversedFuture = computed(() => [...future.value].reverse());

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(locale.value, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

function handleUndo() {
  timelineStore.historyDebounce.clearPendingDebouncedHistory();
  const entry = historyStore.undoGlobal();
  if (!entry) return;
  if (entry.scope === 'timeline') {
    timelineStore.applyRestoredSnapshot(
      entry.snapshot as import('~/timeline/types').TimelineDocument,
    );
  } else if (entry.scope === 'fileManager') {
    void restoreHistory(entry.snapshot);
  }
}

function handleRedo() {
  timelineStore.historyDebounce.clearPendingDebouncedHistory();
  const entry = historyStore.redoGlobal();
  if (!entry) return;
  if (entry.scope === 'timeline') {
    timelineStore.applyRestoredSnapshot(
      entry.snapshot as import('~/timeline/types').TimelineDocument,
    );
  } else if (entry.scope === 'fileManager') {
    void restoreHistory(entry.snapshot);
  }
}

function jumpToState(entryId: string, isFuture: boolean) {
  if (isFuture) {
    const idx = future.value.findIndex((e) => e.id === entryId);
    if (idx === -1) return;
    for (let i = 0; i <= idx; i++) {
      timelineStore.historyDebounce.clearPendingDebouncedHistory();
      const entry = historyStore.redoGlobal();
      if (!entry) break;
      if (entry.scope === 'timeline') {
        timelineStore.applyRestoredSnapshot(
          entry.snapshot as import('~/timeline/types').TimelineDocument,
        );
      } else if (entry.scope === 'fileManager') {
        void restoreHistory(entry.snapshot);
      }
    }
  } else {
    const idxInPast = past.value.findIndex((e) => e.id === entryId);
    if (idxInPast === -1) return;
    const targetIndex = past.value.length - 1 - idxInPast;
    for (let i = 0; i < targetIndex; i++) {
      timelineStore.historyDebounce.clearPendingDebouncedHistory();
      const entry = historyStore.undoGlobal();
      if (!entry) break;
      if (entry.scope === 'timeline') {
        timelineStore.applyRestoredSnapshot(
          entry.snapshot as import('~/timeline/types').TimelineDocument,
        );
      } else if (entry.scope === 'fileManager') {
        void restoreHistory(entry.snapshot);
      }
    }
  }
}
</script>

<template>
  <div v-if="!mobile" class="h-full flex flex-col w-full bg-ui-bg-elevated">
    <div class="flex items-center gap-1.5 px-3 h-9 border-b border-ui-border bg-ui-bg/30 shrink-0">
      <UButton
        icon="i-heroicons-arrow-uturn-left"
        size="xs"
        variant="ghost"
        color="neutral"
        :disabled="!canUndo"
        :title="$t('videoEditor.fileManager.history.actions.undo')"
        class="cursor-pointer"
        @click="handleUndo"
      />
      <UButton
        icon="i-heroicons-arrow-uturn-right"
        size="xs"
        variant="ghost"
        color="neutral"
        :disabled="!canRedo"
        :title="$t('videoEditor.fileManager.history.actions.redo')"
        class="cursor-pointer"
        @click="handleRedo"
      />
    </div>

    <div class="flex-1 overflow-y-auto min-h-0 relative custom-scrollbar">
      <UiEmptyState
        v-if="past.length === 0 && future.length === 0"
        :message="$t('videoEditor.fileManager.history.empty')"
        icon="i-heroicons-arrow-uturn-left"
        icon-class="w-8 h-8 mx-auto mb-3 opacity-20"
        wrapper-class="absolute inset-0 flex flex-col items-center justify-center p-6 opacity-40 select-none"
      />

      <div v-else class="py-2 px-2.5 space-y-1">
        <!-- Future states (Redo) -->
        <div
          v-for="entry in reversedFuture"
          :key="`future-${entry.id}`"
          class="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-all duration-200 cursor-pointer text-ui-text-disabled hover:text-ui-text-muted hover:bg-ui-bg-accent/20"
          @click="jumpToState(entry.id, true)"
        >
          <div class="flex-1 truncate">
            {{ $t(entry.labelKey) }}
          </div>
          <div
            class="text-3xs text-ui-text-muted/60 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            {{ formatTime(entry.timestamp) }}
          </div>
        </div>

        <div v-if="future.length > 0" class="h-px bg-ui-border/50 my-1 mx-2"></div>

        <!-- Current/Past states (Undo) -->
        <div
          v-for="(entry, index) in reversedPast"
          :key="`past-${entry.id}`"
          class="group flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-xs transition-all duration-200"
          :class="[
            index === 0
              ? 'bg-ui-bg-hover text-ui-text font-medium'
              : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-accent/20 cursor-pointer',
          ]"
          @click="index === 0 ? null : jumpToState(entry.id, false)"
        >
          <div class="flex-1 truncate">
            {{ $t(entry.labelKey) }}
          </div>
          <div
            class="text-3xs transition-opacity"
            :class="[
              index === 0
                ? 'text-ui-text-muted'
                : 'text-ui-text-disabled opacity-0 group-hover:opacity-100',
            ]"
          >
            {{ formatTime(entry.timestamp) }}
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Mobile layout -->
  <div v-else class="px-4 py-2 space-y-1">
    <div
      v-if="past.length === 0 && future.length === 0"
      class="py-20 flex flex-col items-center justify-center gap-4 text-ui-text-muted"
    >
      <div class="p-4 rounded-full bg-ui-bg-muted">
        <UIcon name="lucide:history" class="w-8 h-8 opacity-40" />
      </div>
      <span class="text-sm">
        {{ $t('videoEditor.fileManager.history.empty') }}
      </span>
    </div>

    <div v-else>
      <!-- Future states (Redo) -->
      <div
        v-for="entry in reversedFuture"
        :key="`future-${entry.id}`"
        class="flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-all duration-200 active:bg-ui-bg-hover opacity-50"
        @click="jumpToState(entry.id, true)"
      >
        <div class="flex-1 truncate text-ui-text-muted">
          {{ $t(entry.labelKey) }}
        </div>
        <div class="text-[10px] text-ui-text-muted font-mono opacity-50">
          {{ formatTime(entry.timestamp) }}
        </div>
      </div>

      <div v-if="future.length > 0" class="h-px bg-ui-border/50 my-2 mx-2"></div>

      <!-- Current/Past states (Undo) -->
      <div
        v-for="(entry, index) in reversedPast"
        :key="`past-${entry.id}`"
        class="flex items-center gap-3 px-3 py-3 rounded-xl text-sm transition-all duration-200"
        :class="[
          index === 0
            ? 'bg-primary-500/10 text-primary-500'
            : 'text-ui-text active:bg-ui-bg-hover cursor-pointer',
        ]"
        @click="index === 0 ? null : jumpToState(entry.id, false)"
      >
        <div class="flex-1 truncate" :class="[index === 0 ? 'font-semibold' : '']">
          {{ $t(entry.labelKey) }}
        </div>
        <div class="text-[10px] transition-opacity font-mono opacity-50">
          {{ formatTime(entry.timestamp) }}
        </div>
      </div>
    </div>
  </div>
</template>
