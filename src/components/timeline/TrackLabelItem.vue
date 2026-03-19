<script setup lang="ts">
import { computed, ref, nextTick, watch, onBeforeUnmount } from 'vue';
import type { TimelineTrack } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { getAudioMeterColorClass, getAudioMeterPercent, isAudioClipping } from '~/utils/audio';

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
      isSelected ? 'text-ui-text bg-primary-500/12' : '',
      isHovered && !isSelected ? 'text-ui-text bg-ui-bg-elevated/80' : 'text-ui-text-muted',
      timelineStore.isAnyTrackSoloed && !track.audioSolo ? 'opacity-50 grayscale-[0.5]' : '',
    ]"
    :style="{ height: `${height}px` }"
    @click.stop="emit('select')"
    @dblclick="timelineStore.selectAllClipsOnTrack(track.id)"
    @contextmenu.stop="emit('select')"
  >
    <div
      class="absolute left-0 top-0 bottom-0 w-1 transition-colors z-10"
      :class="[isSelected ? 'bg-primary-500' : isHovered ? 'bg-ui-border/50' : 'bg-transparent']"
    />

    <div class="flex-1 min-w-0 flex items-center overflow-hidden pl-1.5 z-10 relative">
      <div
        class="max-w-full px-1 py-0.5 rounded transition-colors overflow-hidden"
        :class="[isRenaming ? 'bg-ui-bg-elevated ring-1 ring-ui-border-accent' : '']"
        @click.stop="timelineStore.renamingTrackId = track.id"
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

    <div class="ml-0 flex items-center gap-0.5 transition-opacity z-10 relative" @dblclick.stop>
      <UButton
        v-if="track.kind === 'video'"
        size="xs"
        :variant="track.videoHidden ? 'solid' : 'ghost'"
        :color="track.videoHidden ? 'amber' : 'gray'"
        :icon="track.videoHidden ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
        class="w-6 h-6 p-0 flex items-center justify-center transition-opacity"
        :class="[
          track.videoHidden
            ? 'text-black! opacity-100 hover:opacity-90'
            : 'opacity-60 group-hover:opacity-100',
        ]"
        :style="track.videoHidden ? { backgroundColor: '#facc15', color: '#000000' } : undefined"
        :title="track.videoHidden ? 'Show Track' : 'Hide Track'"
        @click="toggleVideoHidden"
      />

      <UButton
        size="xs"
        :variant="track.audioMuted ? 'solid' : 'ghost'"
        :color="track.audioMuted ? 'red' : 'gray'"
        :icon="track.audioMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'"
        class="w-6 h-6 p-0 flex items-center justify-center transition-opacity"
        :class="[
          track.audioMuted
            ? 'text-black! opacity-100 hover:opacity-90'
            : 'opacity-60 group-hover:opacity-100',
        ]"
        :style="track.audioMuted ? { backgroundColor: '#ef4444', color: '#000000' } : undefined"
        :title="track.audioMuted ? 'Unmute Track' : 'Mute Track'"
        @click="toggleAudioMuted"
      />

      <UButton
        size="xs"
        :variant="track.audioSolo ? 'solid' : 'ghost'"
        :color="track.audioSolo ? 'amber' : 'gray'"
        icon="i-heroicons-musical-note"
        class="w-6 h-6 p-0 flex items-center justify-center transition-opacity"
        :class="[
          track.audioSolo
            ? 'text-black! opacity-100 hover:opacity-90 ring-1 ring-amber-500/50'
            : 'opacity-60 group-hover:opacity-100',
        ]"
        :style="track.audioSolo ? { backgroundColor: '#fbbf24', color: '#000000' } : undefined"
        :title="track.audioSolo ? 'Unsolo Track' : 'Solo Track'"
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
        class="w-2.5 h-px rounded-full transition-colors pointer-events-auto"
        :class="hasClipped ? 'bg-red-600 shadow-[0_0_6px_rgba(220,38,38,0.75)]' : 'bg-ui-border/70'"
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
