<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useHistoryStore } from '~/stores/history.store';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const historyStore = useHistoryStore();

const past = computed(() => historyStore.past);
const future = computed(() => historyStore.future);

/** Entries shown in the list: future (grayed) then past reversed (newest first) */
const entries = computed(() => {
  const pastReversed = [...past.value].reverse();
  const futureItems = [...future.value].map((e) => ({ ...e, isRedo: true }));
  return [...futureItems.reverse(), ...pastReversed.map((e) => ({ ...e, isRedo: false }))];
});

const hasHistory = computed(() => past.value.length > 0 || future.value.length > 0);

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
</script>

<template>
  <div class="flex flex-col h-full overflow-hidden select-none">
    <!-- Toolbar -->
    <div class="flex items-center gap-1 px-2 py-1.5 border-b border-ui-border/50 shrink-0">
      <UButton
        icon="i-heroicons-arrow-uturn-left"
        variant="ghost"
        color="neutral"
        size="xs"
        :disabled="!historyStore.canUndo"
        :title="t('videoEditor.fileManager.history.undo', 'Undo') + ' (Ctrl+Z)'"
        @click="timelineStore.undoTimeline()"
      />
      <UButton
        icon="i-heroicons-arrow-uturn-right"
        variant="ghost"
        color="neutral"
        size="xs"
        :disabled="!historyStore.canRedo"
        :title="t('videoEditor.fileManager.history.redo', 'Redo') + ' (Ctrl+Shift+Z)'"
        @click="timelineStore.redoTimeline()"
      />
      <span class="ml-auto text-xs text-ui-text-muted">
        {{ past.length }} / {{ past.length + future.length }}
      </span>
    </div>

    <!-- Empty state -->
    <div
      v-if="!hasHistory"
      class="flex flex-col items-center justify-center flex-1 gap-2 text-ui-text-muted px-4 text-center"
    >
      <UIcon name="i-heroicons-clock" class="w-8 h-8 opacity-30" />
      <p class="text-xs">
        {{
          t(
            'videoEditor.fileManager.history.empty',
            'No history yet. Start editing to record actions.',
          )
        }}
      </p>
    </div>

    <!-- History list -->
    <div v-else class="flex-1 overflow-y-auto py-1">
      <div
        v-for="entry in entries"
        :key="entry.id"
        class="flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
        :class="entry.isRedo ? 'opacity-40' : 'text-ui-text'"
      >
        <UIcon
          :name="entry.isRedo ? 'i-heroicons-arrow-uturn-right' : 'i-heroicons-check-circle'"
          class="w-3.5 h-3.5 shrink-0"
          :class="entry.isRedo ? 'text-ui-text-muted' : 'text-primary-400'"
        />
        <span class="flex-1 truncate font-medium">{{ entry.label }}</span>
        <span class="text-ui-text-disabled shrink-0 tabular-nums">{{
          formatTime(entry.timestamp)
        }}</span>
      </div>
    </div>
  </div>
</template>
