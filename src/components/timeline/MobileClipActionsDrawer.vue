<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useWindowSize } from '@vueuse/core';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import { isClipFreePosition } from '~/composables/timeline/clip-context-menu/utils';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-speed-modal', payload: { trackId: string; itemId: string; speed: number }): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();

const { width, height } = useWindowSize();
const isLandscape = computed(() => width.value > height.value);

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) {
      emit('close');
    }
  },
});

const selectedEntity = computed(() => selectionStore.selectedEntity);

const currentClipAndTrack = computed(() => {
  if (selectedEntity.value?.source !== 'timeline' || selectedEntity.value.kind !== 'clip') return null;
  const trackId = selectedEntity.value.trackId;
  const itemId = selectedEntity.value.itemId;

  const track = timelineStore.timelineDoc?.tracks?.find((t) => t.id === trackId) as TimelineTrack | undefined;
  if (!track) return null;
  const item = track.items.find((i) => i.id === itemId) as TimelineClipItem | undefined;
  if (!item || item.kind !== 'clip') return null;
  return { track, item };
});

const clip = computed(() => currentClipAndTrack.value?.item);
const track = computed(() => currentClipAndTrack.value?.track);

const isLocked = computed(() => Boolean(clip.value?.locked || track.value?.locked));

// Generate actions based on `useClipContextMenu` logic
const actions = computed(() => {
  if (!clip.value || !track.value) return [];

  const list: Array<{ label: string; icon: string; action: () => void | Promise<void>; disabled?: boolean; color?: string }> = [];

  // Mute/Unmute
  const hasAudio = track.value.kind === 'audio' || clip.value.clipType === 'media' || clip.value.clipType === 'timeline';
  if (hasAudio) {
    list.push({
      label: clip.value.audioMuted ? t('fastcat.timeline.unmuteClip', 'Unmute') : t('fastcat.timeline.muteClip', 'Mute'),
      icon: clip.value.audioMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark',
      action: async () => {
        timelineStore.updateClipProperties(track.value!.id, clip.value!.id, { audioMuted: !clip.value!.audioMuted });
        await timelineStore.requestTimelineSave({ immediate: true });
      },
    });
  }

  // Lock/Unlock
  list.push({
    label: clip.value.locked ? t('fastcat.timeline.unlockClip', 'Unlock') : t('fastcat.timeline.lockClip', 'Lock'),
    icon: clip.value.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
    action: async () => {
      timelineStore.updateClipProperties(track.value!.id, clip.value!.id, { locked: !clip.value!.locked });
      await timelineStore.requestTimelineSave({ immediate: true });
    },
  });

  // Speed
  const currentSpeed = clip.value.speed ?? 1;
  list.push({
    label: `${t('fastcat.timeline.speed', 'Speed')} (${currentSpeed.toFixed(2)}x)`,
    icon: 'i-heroicons-forward',
    disabled: isLocked.value,
    action: () => {
      emit('open-speed-modal', { trackId: track.value!.id, itemId: clip.value!.id, speed: currentSpeed });
      emit('close');
    },
  });

  // Extract Audio
  const canExtract = track.value.kind === 'video' && clip.value.clipType === 'media' && !(clip.value as any).audioFromVideoDisabled;
  if (canExtract) {
    list.push({
      label: t('fastcat.timeline.extractAudio', 'Extract Audio'),
      icon: 'i-heroicons-musical-note',
      disabled: isLocked.value,
      action: async () => {
        await timelineStore.extractAudioToTrack({ videoTrackId: track.value!.id, videoItemId: clip.value!.id });
        await timelineStore.requestTimelineSave({ immediate: true });
        emit('close');
      },
    });
  }

  // Disable/Enable
  list.push({
    label: clip.value.disabled ? t('fastcat.timeline.enableClip', 'Enable') : t('fastcat.timeline.disableClip', 'Disable'),
    icon: clip.value.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
    action: async () => {
      timelineStore.updateClipProperties(track.value!.id, clip.value!.id, { disabled: !clip.value!.disabled });
      await timelineStore.requestTimelineSave({ immediate: true });
    },
  });

  // Delete
  list.push({
    label: t('fastcat.timeline.delete', 'Delete'),
    icon: 'i-heroicons-trash',
    color: 'error',
    disabled: isLocked.value,
    action: () => {
      timelineStore.deleteFirstSelectedItem();
      emit('close');
    },
  });

  return list;
});
</script>

<template>
  <UDrawer
    v-model:open="isOpenLocal"
    :direction="isLandscape ? 'right' : 'bottom'"
    :title="$t('fastcat.timeline.clipActions', 'Clip Actions')"
  >
    <template #content>
      <div 
        class="flex flex-col ml-auto"
        :class="isLandscape ? 'max-h-dvh w-[50vw]' : 'max-h-[85dvh] w-full'"
      >
        <div class="px-4 py-4 grid grid-cols-3 gap-3 overflow-y-auto pb-safe custom-scrollbar">
          <button
            v-for="(action, idx) in actions"
            :key="idx"
            class="flex flex-col items-center justify-center gap-2 rounded-xl p-3 text-center transition-colors outline-none"
            :class="[
              action.disabled ? 'opacity-50 pointer-events-none grayscale' : 'active:bg-slate-800',
              action.color === 'error' ? 'text-red-400 bg-red-500/10' : 'text-slate-200 bg-slate-900/80 border border-slate-800'
            ]"
            @click="action.action"
          >
            <UIcon :name="action.icon" class="w-6 h-6" />
            <span class="text-xs font-medium">{{ action.label }}</span>
          </button>
        </div>
      </div>
    </template>
  </UDrawer>
</template>

<style scoped>
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 24px);
}
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #334155;
  border-radius: 10px;
}
</style>
