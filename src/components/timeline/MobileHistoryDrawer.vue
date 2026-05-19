<script setup lang="ts">
import { computed } from 'vue';
import { useHistoryStore } from '~/stores/history.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';

defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const { locale } = useI18n();
const historyStore = useHistoryStore();
const timelineStore = useTimelineStore();
const { restoreHistory } = useFileManager();

const past = computed(() => historyStore.past);
const future = computed(() => historyStore.future);

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
  const entry = historyStore.undoGlobal();
  if (!entry) return;
  if (entry.scope === 'timeline') {
    timelineStore.applyRestoredSnapshot(entry.snapshot);
  } else if (entry.scope === 'fileManager') {
    void restoreHistory(entry.snapshot);
  }
}

function handleRedo() {
  const entry = historyStore.redoGlobal();
  if (!entry) return;
  if (entry.scope === 'timeline') {
    timelineStore.applyRestoredSnapshot(entry.snapshot);
  } else if (entry.scope === 'fileManager') {
    void restoreHistory(entry.snapshot);
  }
}

function jumpToState(entryId: string, isFuture: boolean) {
  if (isFuture) {
    const idx = future.value.findIndex((e) => e.id === entryId);
    if (idx === -1) return;
    for (let i = 0; i <= idx; i++) {
      const entry = historyStore.redoGlobal();
      if (!entry) break;
      if (entry.scope === 'timeline') {
        timelineStore.applyRestoredSnapshot(entry.snapshot);
      } else if (entry.scope === 'fileManager') {
        void restoreHistory(entry.snapshot);
      }
    }
  } else {
    const idxInPast = past.value.findIndex((e) => e.id === entryId);
    if (idxInPast === -1) return;
    const targetIndex = past.value.length - 1 - idxInPast;
    for (let i = 0; i < targetIndex; i++) {
      const entry = historyStore.undoGlobal();
      if (!entry) break;
      if (entry.scope === 'timeline') {
        timelineStore.applyRestoredSnapshot(entry.snapshot);
      } else if (entry.scope === 'fileManager') {
        void restoreHistory(entry.snapshot);
      }
    }
  }
}
</script>

<template>
  <UiMobileDrawer
    :open="isOpen"
    :show-close="false"
    :ui="{ body: 'pb-8' }"
    @update:open="$emit('close')"
  >
    <div class="px-4 py-2 space-y-1">
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
  </UiMobileDrawer>
</template>
