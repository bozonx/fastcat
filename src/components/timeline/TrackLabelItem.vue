<script setup lang="ts">
import { computed, ref, nextTick, watch } from 'vue';
import type { TimelineTrack } from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';

const props = defineProps<{
  track: TimelineTrack;
  height: number;
  isSelected: boolean;
  isHovered: boolean;
  isRenaming: boolean;
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
</script>

<template>
  <div
    class="flex items-center px-1 text-xs font-medium cursor-pointer select-none relative group border-b border-ui-border"
    :class="[
      isSelected ? 'text-ui-text bg-ui-bg-accent/20' : '',
      isHovered && !isSelected ? 'text-ui-text bg-ui-bg-elevated/80' : 'text-ui-text-muted',
    ]"
    :style="{ height: `${height}px` }"
    @click="emit('select')"
    @dblclick="timelineStore.selectAllClipsOnTrack(track.id)"
    @contextmenu="emit('select')"
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
        @click.stop="timelineStore.renamingTrackId = track.id"
        @dblclick.stop
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

    <!-- Bottom Resize Handle -->
    <div
      class="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize z-20 hover:bg-primary-500/50 transition-colors"
      @mousedown.stop.prevent="emit('resizeStart', $event)"
    />
  </div>
</template>
