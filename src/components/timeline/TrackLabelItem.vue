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
const renameInput = ref<{ input: HTMLInputElement } | null>(null);
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
      renameInput.value?.input?.focus();
      renameInput.value?.input?.select();
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

function toggleTrackLock(e: MouseEvent) {
  e.stopPropagation();
  timelineStore.updateTrackProperties(props.track.id, { locked: !props.track.locked });
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
    class="flex items-center px-1 text-xs font-medium cursor-pointer select-none relative group border-b border-ui-border transition-colors"
    :data-track-id="track.id"
    :class="[
      isSelected ? 'text-ui-text' : 'text-ui-text-muted',
      isHovered && !isSelected ? 'bg-ui-bg-elevated/80' : '',
      timelineStore.isAnyTrackSoloed && !track.audioSolo ? 'opacity-50 grayscale-[0.5]' : '',
      track.locked ? 'grayscale-[0.3]' : '',
    ]"
    :style="{
      height: `${height}px`,
      backgroundColor:
        isSelected && track.color && track.color !== '#2a2a2a'
          ? `${track.color}1a`
          : isSelected
            ? 'rgba(var(--color-primary-500), 0.12)'
            : undefined,
    }"
    @click.stop="emit('select')"
    @dblclick="!track.locked && timelineStore.selectAllClipsOnTrack(track.id)"
    @contextmenu.stop="emit('select')"
  >
    <div
      class="absolute left-0 top-0 bottom-0 w-1 transition-colors z-10"
      :class="[
        isSelected && (!track.color || track.color === '#2a2a2a')
          ? 'bg-(--selection-accent-500)'
          : isHovered && (!track.color || track.color === '#2a2a2a')
            ? 'bg-ui-border/50'
            : '',
      ]"
      :style="{
        backgroundColor:
          (isSelected || isHovered) && track.color && track.color !== '#2a2a2a'
            ? track.color
            : undefined,
      }"
    />

    <div class="flex-1 min-w-0 flex items-center overflow-hidden pl-1.5 z-10 relative">
      <div
        class="max-w-full px-1 py-0.5 rounded transition-colors overflow-hidden"
        :class="[isRenaming ? 'bg-ui-bg-elevated ring-1 ring-ui-border-accent' : '']"
        :style="{
          backgroundColor:
            !isRenaming && isSelected && track.color && track.color !== '#2a2a2a'
              ? `${track.color}33`
              : undefined,
        }"
        @click.stop="timelineStore.renamingTrackId = track.id"
      >
        <UInput
          v-if="isRenaming"
          ref="renameInput"
          v-model="renameValue"
          size="xs"
          class="w-full"
          :ui="{ base: 'bg-transparent border-none text-[10px] font-medium p-0' }"
          :style="{
            width: `${Math.max(4, renameValue.length + 2)}ch`,
            minWidth: '4ch',
            maxWidth: '100%',
          }"
          @click.stop
          @keydown.enter.stop="confirmRename"
          @keydown.esc.stop="emit('cancelRename')"
          @blur="confirmRename"
        />
        <span v-else class="truncate block text-[10px]" :title="track.name">{{ track.name }}</span>
      </div>
    </div>

    <div class="ml-0 flex items-center gap-0.5 transition-opacity z-10 relative" @dblclick.stop>
      <UiToggleButton
        v-if="track.kind === 'video'"
        :model-value="track.videoHidden || false"
        icon="i-heroicons-eye"
        active-icon="i-heroicons-eye-slash"
        inactive-color="neutral"
        active-color="warning"
        :active-bg="'#facc15'"
        :active-text="'#000000'"
        title="Hide/Show Track"
        @click="toggleVideoHidden"
      />

      <UiToggleButton
        :model-value="track.audioMuted || false"
        icon="i-heroicons-speaker-wave"
        active-icon="i-heroicons-speaker-x-mark"
        inactive-color="neutral"
        active-color="error"
        :active-bg="'#ef4444'"
        :active-text="'#000000'"
        title="Mute/Unmute Track"
        @click="toggleAudioMuted"
      />

      <UiToggleButton
        :model-value="track.audioSolo || false"
        icon="i-heroicons-musical-note"
        inactive-color="neutral"
        active-color="warning"
        :active-bg="'#fbbf24'"
        :active-text="'#000000'"
        title="Solo Track"
        @click="toggleAudioSolo"
      />

      <UiToggleButton
        v-if="track.locked"
        :model-value="true"
        icon="i-heroicons-lock-closed"
        :active-bg="'#3b82f6'"
        :active-text="'#ffffff'"
        title="Unlock Track"
        @click="toggleTrackLock"
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
