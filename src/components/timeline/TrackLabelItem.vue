<script setup lang="ts">
import { computed, ref, nextTick, watch, onBeforeUnmount } from 'vue';
import type { TimelineTrack } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import {
  getAudioMeterColorClass,
  getAudioMeterPercent,
  isAudioClipping,
} from '~/utils/audio';

const props = defineProps<{
  track: TimelineTrack;
  height: number;
  isSelected: boolean;
  isHovered: boolean;
  isRenaming: boolean;
  hasAudio?: boolean;
  levelDb?: number;
}>();

const emit = defineEmits<{
  (e: 'select'): void;
  (e: 'rename', name: string): void;
  (e: 'cancelRename'): void;
  (e: 'resizeStart', event: MouseEvent): void;
  (e: 'contextMenu'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const renameValue = ref(props.track.name);
const renameInput = ref<HTMLInputElement | null>(null);
const hasClipped = ref(false);
let clipResetTimeoutId: ReturnType<typeof setTimeout> | null = null;

const levelPercent = computed(() => getAudioMeterPercent(props.levelDb, -60, 12));
const levelColorClass = computed(() => getAudioMeterColorClass(props.levelDb));

watch(
  () => props.isRenaming,
  async (val) => {
    if (val) {
      renameValue.value = props.track.name;
      await nextTick();
      renameInput.value?.focus();
      renameInput.value?.select();
    }
  },
);

watch(
  () => props.levelDb,
  (value) => {
    if (!isAudioClipping(value)) return;

    hasClipped.value = true;

    if (clipResetTimeoutId) {
      clearTimeout(clipResetTimeoutId);
    }

    clipResetTimeoutId = setTimeout(() => {
      hasClipped.value = false;
      clipResetTimeoutId = null;
    }, 1400);
  },
);

function resetClipIndicator(event: MouseEvent) {
  event.stopPropagation();
  hasClipped.value = false;

  if (clipResetTimeoutId) {
    clearTimeout(clipResetTimeoutId);
    clipResetTimeoutId = null;
  }
}

function confirmRename() {
  const next = renameValue.value.trim();
  if (next && next !== props.track.name) {
    emit('rename', next);
  } else {
    emit('cancelRename');
  }
}

function toggleVideoHidden(e: MouseEvent) {
  e.stopPropagation();
  timelineStore.toggleVideoHidden(props.track.id);
}

function toggleAudioMuted(e: MouseEvent) {
  e.stopPropagation();
  timelineStore.toggleTrackAudioMuted(props.track.id);
}

function toggleAudioSolo(e: MouseEvent) {
  e.stopPropagation();
  timelineStore.toggleTrackAudioSolo(props.track.id);
}

onBeforeUnmount(() => {
  if (clipResetTimeoutId) {
    clearTimeout(clipResetTimeoutId);
    clipResetTimeoutId = null;
  }
});
</script>

<template>
  <div
    class="flex items-center px-1 text-xs font-medium cursor-pointer select-none relative group border-b border-ui-border"
    :data-track-id="track.id"
    :class="[
      isSelected ? 'text-ui-text bg-ui-bg-accent/20' : '',
      isHovered && !isSelected ? 'text-ui-text bg-ui-bg-elevated/80' : 'text-ui-text-muted',
    ]"
    :style="{ height: `${height}px` }"
    @click.stop="emit('select')"
    @dblclick="timelineStore.selectAllClipsOnTrack(track.id)"
    @contextmenu.stop="emit('select')"
  >
    <!-- Track Drag Handle (Left) -->
    <div
      class="w-1 h-2/3 rounded-full bg-ui-border opacity-0 group-hover:opacity-100 transition-opacity mr-1"
    />

    <div class="flex-1 min-w-0 flex items-center overflow-hidden">
      <div
        class="max-w-full px-1 py-0.5 rounded border border-transparent transition-colors overflow-hidden"
        :class="[
          isRenaming ? 'bg-ui-bg-elevated border-ui-border-accent' : 'hover:border-ui-border/50',
        ]"
        @dblclick.stop="timelineStore.renamingTrackId = track.id"
      >
        <input
          v-if="isRenaming"
          ref="renameInput"
          v-model="renameValue"
          class="bg-transparent border-none outline-none text-xs font-medium p-0 m-0 block whitespace-nowrap overflow-hidden text-ellipsis"
          :style="{ width: `${renameValue.length + 2}ch`, minWidth: '4ch', maxWidth: '100%' }"
          @click.stop
          @keydown.enter.stop="confirmRename"
          @keydown.esc.stop="emit('cancelRename')"
          @blur="confirmRename"
        />
        <span v-else class="truncate block" :title="track.name">{{ track.name }}</span>
      </div>
    </div>

    <div
      class="ml-0 flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity"
      @dblclick.stop
    >
      <UButton
        v-if="track.kind === 'video'"
        size="xs"
        variant="ghost"
        color="neutral"
        :icon="track.videoHidden ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
        class="w-6 h-6 p-0"
        @click="toggleVideoHidden"
      />

      <UButton
        size="xs"
        variant="ghost"
        :color="track.audioMuted ? 'error' : 'neutral'"
        :icon="track.audioMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'"
        class="w-6 h-6 p-0"
        @click="toggleAudioMuted"
      />

      <UButton
        size="xs"
        variant="ghost"
        :color="track.audioSolo ? 'primary' : 'neutral'"
        icon="i-heroicons-musical-note"
        class="w-6 h-6 p-0"
        @click="toggleAudioSolo"
      />
    </div>

    <div
      v-if="hasAudio"
      class="absolute left-1 right-1 bottom-1 h-1 flex items-center gap-1 pointer-events-none"
    >
      <div class="relative flex-1 h-px bg-ui-border/70 overflow-hidden rounded-full">
        <div
          class="absolute inset-y-0 left-0 transition-[width] duration-75 rounded-full"
          :class="levelColorClass"
          :style="{ width: `${levelPercent}%` }"
        />
      </div>
      <button
        type="button"
        class="w-2.5 h-1.5 rounded-[2px] border border-ui-border transition-colors pointer-events-auto"
        :class="hasClipped ? 'bg-red-600 shadow-[0_0_6px_rgba(220,38,38,0.75)]' : 'bg-ui-bg-dark'"
        :title="hasClipped ? 'Clipped! Click to reset' : ''"
        @click="resetClipIndicator"
      />
    </div>

    <!-- Bottom Resize Handle -->
    <div
      class="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize z-20 hover:bg-primary-500/50 transition-colors"
      @mousedown.stop.prevent="emit('resizeStart', $event)"
    />
  </div>
</template>
