<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue';
import type { TimelineTrack } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { getAudioMeterColorClass, getAudioMeterPercent, isAudioClipping } from '~/utils/audio';

const props = defineProps<{
  track: TimelineTrack;
  height: number;
  isSelected: boolean;
  /** True only when the track header itself is selected, not just a clip/gap/transition on it. */
  isDirectlySelected: boolean;
  isHovered: boolean;
  isRenaming?: boolean;
  hasAudio?: boolean;
  levelDb?: number;
  trackNumber: number;
}>();

const emit = defineEmits<{
  (e: 'select'): void;
  (e: 'request-rename'): void;
  (e: 'rename', name: string): void;
  (e: 'cancelRename'): void;
  (e: 'resizeStart', event: PointerEvent): void;
  (e: 'contextMenu'): void;
  (e: 'middleClick', event: MouseEvent): void;
}>();

const timelineStore = useTimelineStore();

const renameValue = ref(props.track.name);
const renameInput = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);

const hasClipped = ref(false);
let clipResetTimeoutId: ReturnType<typeof setTimeout> | null = null;
let clipResetDeadlineMs = 0;

function clearClipResetTimeout() {
  if (!clipResetTimeoutId) return;
  clearTimeout(clipResetTimeoutId);
  clipResetTimeoutId = null;
}

function scheduleClipReset() {
  const remainingMs = clipResetDeadlineMs - Date.now();
  if (remainingMs <= 0) {
    hasClipped.value = false;
    clipResetDeadlineMs = 0;
    clipResetTimeoutId = null;
    return;
  }

  if (clipResetTimeoutId) return;

  clipResetTimeoutId = setTimeout(() => {
    clipResetTimeoutId = null;
    scheduleClipReset();
  }, remainingMs);
}

const levelPercent = computed(() => getAudioMeterPercent(props.levelDb, -60, 12));
const levelColorClass = computed(() => getAudioMeterColorClass(props.levelDb));

// Calculate available space for text wrap and the maximum number of lines that can fit
const remainingHeight = computed(() => props.height - 28 - (props.hasAudio ? 16 : 8));
const lineCount = computed(() => Math.max(1, Math.floor(remainingHeight.value / 13)));

watch(
  () => props.levelDb,
  (value) => {
    if (!isAudioClipping(value)) return;

    hasClipped.value = true;
    clipResetDeadlineMs = Date.now() + 1400;
    scheduleClipReset();
  },
);

watch(
  () => props.isRenaming,
  async (newVal) => {
    if (newVal) {
      renameValue.value = props.track.name;
      await nextTick();
      if (renameInput.value) {
        renameInput.value.focus();
        renameInput.value.select();
        // Use timeout fallback to guarantee focus after visual transitions settle
        setTimeout(() => {
          if (renameInput.value) {
            renameInput.value.focus();
            renameInput.value.select();
          }
        }, 50);
      }
    }
  },
  { immediate: true },
);

function resetClipIndicator(event: MouseEvent) {
  event.stopPropagation();
  hasClipped.value = false;
  clipResetDeadlineMs = 0;
  clearClipResetTimeout();
}

function startRenaming() {
  if (props.isSelected) {
    emit('request-rename');
  } else {
    emit('select');
  }
}

function confirmRename() {
  const trimmed = renameValue.value.trim();
  if (trimmed && trimmed !== props.track.name) {
    emit('rename', trimmed);
  } else {
    emit('cancelRename');
  }
}

function toggleVideoHidden(e: MouseEvent) {
  e.stopPropagation();
  timelineStore.toggleVideoHidden(props.track.id);
}

// Ensure single line comments are strictly above the commented line as per guidelines.
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
  clearClipResetTimeout();
  clipResetDeadlineMs = 0;
});
</script>

<template>
  <div
    class="flex items-start p-1.5 text-xs font-medium cursor-pointer select-none relative group border-b border-ui-border transition-colors overflow-hidden"
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
        track.color && track.color !== '#2a2a2a'
          ? isDirectlySelected
            ? `${track.color}33`
            : `${track.color}1a`
          : isDirectlySelected
            ? 'color-mix(in srgb, var(--color-selection-accent-500) 12%, transparent)'
            : undefined,
    }"
    @click.stop="emit('select')"
    @auxclick.stop="(e) => e.button === 1 && emit('middleClick', e)"
    @dblclick="!track.locked && timelineStore.selectAllClipsOnTrack(track.id)"
    @contextmenu.stop="emit('select')"
  >
    <!-- Left Accent/Track Color Indicator — shown when track is selected directly or has active clip/gap -->
    <div
      class="absolute left-0 top-0 bottom-0 w-1 transition-colors z-10"
      :class="[
        isDirectlySelected && (!track.color || track.color === '#2a2a2a')
          ? 'bg-selection-accent-500'
          : isHovered && (!track.color || track.color === '#2a2a2a')
            ? 'bg-ui-border/50'
            : '',
      ]"
      :style="{
        backgroundColor:
          track.color && track.color !== '#2a2a2a'
            ? isDirectlySelected
              ? track.color
              : isHovered
                ? `${track.color}80`
                : undefined
            : undefined,
      }"
    />

    <div class="flex-1 flex flex-col min-w-0 h-full overflow-hidden ml-1 z-10 relative">
      <!-- Row 1: Track ID, Truncated Name (when height < 50), and Buttons -->
      <div class="flex items-center gap-1.5 min-w-0 shrink-0 h-4.5">
        <!-- Track Number Block (e.g., V1, A1) -->
        <!-- Color matches left border whenever track or any item on it is selected -->
        <div
          class="shrink-0 flex items-center justify-center min-w-[20px] pr-1 border-r border-ui-border text-[9px] font-black uppercase tracking-tight h-3 my-auto transition-colors"
          :style="{
            color:
              isDirectlySelected && track.color && track.color !== '#2a2a2a'
                ? track.color
                : isDirectlySelected
                  ? 'var(--color-selection-accent-500)'
                  : undefined,
          }"
        >
          {{ track.kind === 'video' ? 'V' : 'A' }}{{ trackNumber }}
        </div>

        <!-- Truncated Name in first row when height is small -->
        <div
          v-if="height < 52"
          class="min-w-[20px] max-w-[150px] flex items-center overflow-hidden"
        >
          <!-- Inline Grid to size input precisely to text width -->
          <div
            v-if="isRenaming"
            class="inline-grid items-center grid-cols-1 w-full bg-ui-bg-elevated border border-ui-border-accent rounded-sm px-1"
          >
            <span
              class="invisible col-start-1 row-start-1 text-[10px] font-medium leading-tight px-0.5 whitespace-pre min-w-[20px]"
            >
              {{ renameValue || ' ' }}
            </span>
            <input
              ref="renameInput"
              v-model="renameValue"
              class="col-start-1 row-start-1 w-full bg-transparent border-none outline-none ring-0 p-0 text-[10px] font-medium leading-tight px-0.5 select-text text-ui-text focus:outline-none min-w-[20px]"
              @click.stop
              @keydown.enter.stop="confirmRename"
              @keydown.esc.stop="emit('cancelRename')"
              @blur="confirmRename"
            />
          </div>
          <div
            v-else
            class="rounded px-0.5 hover:bg-ui-bg-accent/30 cursor-pointer overflow-hidden max-w-full"
            @click.stop="startRenaming"
          >
            <span class="truncate block text-[10px] font-medium leading-tight" :title="track.name">
              {{ track.name }}
            </span>
          </div>
        </div>

        <div class="flex-1" />

        <!-- Track Buttons -->
        <div class="flex items-center gap-1.5 ml-auto" @dblclick.stop>
          <UiToggleButton
            v-if="track.locked"
            :model-value="true"
            size="xs"
            class="w-4 h-4 p-0! text-[10px]! rounded-full"
            icon="i-heroicons-lock-closed"
            :active-bg="'#3b82f6'"
            :active-text="'#ffffff'"
            title="Unlock Track"
            @click="toggleTrackLock"
          />

          <UiToggleButton
            v-if="track.kind === 'video'"
            :model-value="track.videoHidden || false"
            size="xs"
            class="w-4 h-4 p-0! text-[10px]! rounded-full"
            icon="i-heroicons-eye"
            active-icon="i-heroicons-eye-slash"
            inactive-color="neutral"
            active-color="primary"
            :active-bg="'#ffffff'"
            :active-text="'#000000'"
            title="Hide/Show Track"
            @click="toggleVideoHidden"
          />

          <UiToggleButton
            :model-value="track.audioMuted || false"
            size="xs"
            class="w-4 h-4 p-0! text-[10px]! rounded-full"
            icon="i-heroicons-speaker-wave"
            active-icon="i-heroicons-speaker-x-mark"
            inactive-color="neutral"
            active-color="error"
            :active-bg="'#ef4444'"
            :active-text="'#ffffff'"
            title="Mute/Unmute Track"
            @click="toggleAudioMuted"
          />

          <UiToggleButton
            :model-value="track.audioSolo || false"
            size="xs"
            class="w-4 h-4 p-0! text-[10px]! rounded-full"
            icon="i-heroicons-musical-note"
            inactive-color="neutral"
            active-color="success"
            :active-bg="'#22c55e'"
            :active-text="'#ffffff'"
            title="Solo Track"
            @click="toggleAudioSolo"
          />
        </div>
      </div>

      <!-- Row 2: Multi-line Name / Description (when height >= 52) -->
      <div
        v-if="height >= 52"
        class="mt-1 min-w-0 overflow-hidden relative"
        :class="
          isRenaming
            ? 'flex-1 h-full w-full'
            : 'flex flex-col items-start max-h-[calc(100%-1.5rem)]'
        "
      >
        <div
          v-if="isRenaming"
          class="w-full h-full bg-ui-bg-elevated border border-ui-border-accent rounded-sm px-1 py-0.5"
        >
          <textarea
            ref="renameInput"
            v-model="renameValue"
            class="w-full h-full bg-transparent border-none outline-none ring-0 p-0 text-[10px] leading-tight font-medium resize-none select-text text-ui-text focus:outline-none overflow-y-auto"
            @click.stop
            @keydown.esc.stop="emit('cancelRename')"
            @blur="confirmRename"
          />
        </div>
        <div
          v-else
          class="max-w-full px-0.5 pt-0.5 hover:bg-ui-bg-accent/30 rounded cursor-pointer"
          @click.stop="startRenaming"
        >
          <span
            class="text-[10px] text-ui-text-muted leading-tight wrap-break-word block whitespace-pre-wrap"
            :style="{
              display: '-webkit-box',
              '-webkit-box-orient': 'vertical',
              '-webkit-line-clamp': lineCount,
              overflow: 'hidden',
            }"
          >
            {{ track.name }}
          </span>
        </div>
      </div>
    </div>

    <!-- Audio Meter (bottom alignment) -->
    <div
      v-if="hasAudio"
      class="absolute left-1.5 right-1.5 bottom-1.5 h-1 flex items-center gap-1 pointer-events-none z-10"
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
      class="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize z-20 hover:bg-primary-500/50 transition-colors touch-none"
      @pointerdown.stop.prevent="emit('resizeStart', $event)"
    />
  </div>
</template>
