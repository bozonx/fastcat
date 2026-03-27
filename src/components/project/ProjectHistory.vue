<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useHistoryStore } from '~/stores/history.store';

// Import useFileManager here to avoid circular dependencies if any,
// though it should be fine as it's a composable.
import { useFileManager } from '~/composables/fileManager/useFileManager';

const timelineStore = useTimelineStore();
const historyStore = useHistoryStore();

const past = computed(() => historyStore.past);
const future = computed(() => historyStore.future);

const { restoreHistory } = useFileManager();

const canUndo = computed(() => historyStore.canUndo());
const canRedo = computed(() => historyStore.canRedo());

const history = computed(() => [...future.value, ...past.value]);

const reversedPast = computed(() => [...past.value].reverse());
const reversedFuture = computed(() => [...future.value].reverse());

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(navigator.language, {
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
</script>

<template>
  <div class="h-full flex flex-col w-full bg-slate-900 border-l border-slate-800">
    <div
      class="px-4 py-3 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400 font-medium tracking-wide uppercase"
    >
      <span>{{ $t('videoEditor.fileManager.history.title') }}</span>
      <div class="flex items-center gap-2">
        <button
          class="hover:text-white transition-colors disabled:opacity-30 disabled:hover:text-slate-400"
          :disabled="!canUndo"
          :title="$t('videoEditor.fileManager.history.actions.undo')"
          @click="handleUndo"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
            />
          </svg>
        </button>
        <button
          class="hover:text-white transition-colors disabled:opacity-30 disabled:hover:text-slate-400"
          :disabled="!canRedo"
          :title="$t('videoEditor.fileManager.history.actions.redo')"
          @click="handleRedo"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6"
            />
          </svg>
        </button>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto min-h-0 relative">
      <div v-if="history.length === 0" class="absolute inset-0 flex items-center justify-center">
        <span class="text-sm text-slate-500">{{
          $t('videoEditor.fileManager.history.empty')
        }}</span>
      </div>

      <div v-else class="py-2 px-3 space-y-1">
        <!-- Future states (Redo) -->
        <div
          v-for="entry in reversedFuture"
          :key="`future-${entry.id}`"
          class="group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200 cursor-pointer opacity-50 hover:opacity-100 hover:bg-slate-800/50"
        >
          <div class="w-2 h-2 rounded-full bg-slate-700"></div>
          <div class="flex-1 truncate text-slate-400">
            {{ $t(entry.labelKey) }}
          </div>
          <div class="text-xs text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity">
            {{ formatTime(entry.timestamp) }}
          </div>
        </div>

        <div v-if="future.length > 0" class="h-px bg-slate-800/50 my-2 mx-2"></div>

        <!-- Current/Past states (Undo) -->
        <div
          v-for="(entry, index) in reversedPast"
          :key="`past-${entry.id}`"
          class="group flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-200"
          :class="[
            index === 0
              ? 'bg-blue-500/10 text-blue-400'
              : 'text-slate-300 hover:bg-slate-800/50 cursor-pointer',
          ]"
        >
          <div
            class="w-2 h-2 rounded-full"
            :class="[
              index === 0 ? 'bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]' : 'bg-slate-600',
            ]"
          ></div>
          <div class="flex-1 truncate" :class="[index === 0 ? 'font-medium' : '']">
            {{ $t(entry.labelKey) }}
          </div>
          <div
            class="text-xs transition-opacity"
            :class="[
              index === 0 ? 'text-blue-400/70' : 'text-slate-500 opacity-0 group-hover:opacity-100',
            ]"
          >
            {{ formatTime(entry.timestamp) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
