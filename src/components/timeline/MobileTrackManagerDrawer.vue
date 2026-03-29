<script setup lang="ts">
import { computed } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWindowSize } from '@vueuse/core';
import type { TimelineTrack } from '~/timeline/types';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

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

const tracks = computed(() => timelineStore.timelineDoc?.tracks as TimelineTrack[] ?? []);

function toggleLock(trackId: string) {
  const t = tracks.value.find(x => x.id === trackId);
  if (t) {
    timelineStore.updateTrackProperties(trackId, { locked: !t.locked });
    timelineStore.requestTimelineSave({ immediate: true });
  }
}

function toggleMute(trackId: string) {
  const t = tracks.value.find(x => x.id === trackId);
  if (t) {
    timelineStore.updateTrackProperties(trackId, { audioMuted: !t.audioMuted });
    timelineStore.requestTimelineSave({ immediate: true });
  }
}

function toggleHide(trackId: string) {
  const t = tracks.value.find(x => x.id === trackId);
  if (t) {
    timelineStore.updateTrackProperties(trackId, { videoHidden: !t.videoHidden });
    timelineStore.requestTimelineSave({ immediate: true });
  }
}
</script>

<template>
  <UDrawer
    v-model:open="isOpenLocal"
    :direction="isLandscape ? 'right' : 'bottom'"
    :title="$t('fastcat.timeline.manageTracks', 'Manage Tracks')"
  >
    <template #content>
      <div 
        class="flex flex-col ml-auto"
        :class="isLandscape ? 'max-h-dvh w-[50vw]' : 'max-h-[85dvh] w-full'"
      >
        <div class="px-4 py-2 flex flex-col gap-2 overflow-y-auto pb-safe custom-scrollbar">
          <div v-for="track in tracks" :key="track.id" class="flex items-center justify-between bg-slate-900/50 p-3 rounded-lg border border-slate-800">
            <div class="flex items-center gap-3 min-w-0">
              <div 
                class="w-3 h-3 rounded-full shrink-0" 
                :style="{ backgroundColor: track.color && track.color !== '#2a2a2a' ? track.color : '#64748b' }"
              />
              <span class="text-sm font-medium text-slate-200 truncate">{{ track.name || track.id }}</span>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <UButton
                v-if="track.kind === 'video'"
                :icon="track.videoHidden ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
                :color="track.videoHidden ? 'primary' : 'neutral'"
                variant="ghost"
                @click="toggleHide(track.id)"
              />
              <UButton
                :icon="track.audioMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'"
                :color="track.audioMuted ? 'red' : 'neutral'"
                variant="ghost"
                @click="toggleMute(track.id)"
              />
              <UButton
                :icon="track.locked ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open'"
                :color="track.locked ? 'primary' : 'neutral'"
                variant="ghost"
                @click="toggleLock(track.id)"
              />
            </div>
          </div>
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
