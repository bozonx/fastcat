<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
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
const workspaceStore = useWorkspaceStore();

const { width, height } = useWindowSize();
const isLandscape = computed(() => width.value > height.value);

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

const tracks = computed(() => (timelineStore.timelineDoc?.tracks as TimelineTrack[]) ?? []);

function toggleLock(trackId: string) {
  const t = tracks.value.find((x) => x.id === trackId);
  if (t) {
    timelineStore.updateTrackProperties(trackId, { locked: !t.locked });
    timelineStore.requestTimelineSave({ immediate: true });
  }
}

function toggleMute(trackId: string) {
  const t = tracks.value.find((x) => x.id === trackId);
  if (t) {
    timelineStore.toggleTrackAudioMuted(trackId);
    timelineStore.requestTimelineSave({ immediate: true });
  }
}

function toggleSolo(trackId: string) {
  const t = tracks.value.find((x) => x.id === trackId);
  if (t) {
    timelineStore.toggleTrackAudioSolo(trackId);
    timelineStore.requestTimelineSave({ immediate: true });
  }
}

function toggleHide(trackId: string) {
  const t = tracks.value.find((x) => x.id === trackId);
  if (t) {
    timelineStore.updateTrackProperties(trackId, { videoHidden: !t.videoHidden });
    timelineStore.requestTimelineSave({ immediate: true });
  }
}

function handleTrackGainInput(trackId: string, event: Event) {
  const target = event.target as HTMLInputElement;
  const numeric = Number(target.value);
  timelineStore.updateTrackProperties(trackId, {
    audioGain: Math.max(0, Math.min(4, numeric / 100)),
  });
}

function getTrackGain(track: TimelineTrack) {
  return typeof track.audioGain === 'number' ? track.audioGain : 1;
}

const masterVolume = computed({
  get: () => Math.round(timelineStore.masterGain * 100),
  set: (value: number) => {
    timelineStore.setMasterGain(Math.max(0, Math.min(4, value / 100)));
  },
});

const isMasterMuted = computed(() => timelineStore.audioMuted);

function toggleMasterMute() {
  timelineStore.audioMuted = !timelineStore.audioMuted;
}

function updateMasterVolume(event: Event) {
  const target = event.target as HTMLInputElement;
  masterVolume.value = target.valueAsNumber;
}

function formatDb(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} dB`;
}

function addVideoTrack() {
  const videoCount = tracks.value.filter(t => t.kind === 'video').length;
  timelineStore.addTrack('video', `Video ${videoCount + 1}`);
}

function addAudioTrack() {
  const audioCount = tracks.value.filter(t => t.kind === 'audio').length;
  timelineStore.addTrack('audio', `Audio ${audioCount + 1}`);
}

const isConfirmDeleteOpen = ref(false);
const trackToDeleteId = ref<string | null>(null);
const selectedTrackForDelete = computed(() => tracks.value.find((t) => t.id === trackToDeleteId.value));

function confirmDelete() {
  if (trackToDeleteId.value) {
    timelineStore.deleteTrack(trackToDeleteId.value, { allowNonEmpty: true });
    trackToDeleteId.value = null;
  }
}

function requestDeleteTrack(track: TimelineTrack) {
  const skipConfirm = workspaceStore.userSettings.deleteWithoutConfirmation;
  if (track.items.length > 0 && !skipConfirm) {
    trackToDeleteId.value = track.id;
    isConfirmDeleteOpen.value = true;
  } else {
    timelineStore.deleteTrack(track.id);
  }
}

const renamingTrackId = ref<string | null>(null);
const renameValue = ref('');

function startRename(track: TimelineTrack) {
  renamingTrackId.value = track.id;
  renameValue.value = track.name || track.id;
}

function confirmRename() {
  if (renamingTrackId.value) {
    const next = renameValue.value.trim();
    const track = tracks.value.find(t => t.id === renamingTrackId.value);
    if (track && next && next !== track.name) {
      timelineStore.renameTrack(renamingTrackId.value, next);
    }
  }
  renamingTrackId.value = null;
}

function getTrackMenuItems(track: TimelineTrack) {
  return [
    [
      {
        label: t('fastcat.timeline.renameTrack', 'Rename Track'),
        icon: 'lucide:pencil',
        onSelect: () => startRename(track),
      },
      {
        label: track.locked ? t('fastcat.track.unlock', 'Unlock track') : t('fastcat.track.lock', 'Lock track'),
        icon: track.locked ? 'lucide:lock-open' : 'lucide:lock',
        onSelect: () => toggleLock(track.id),
      },
      {
        label: t('fastcat.timeline.deleteTrack', 'Delete Track'),
        icon: 'lucide:trash-2',
        iconClass: 'text-error-500',
        onSelect: () => requestDeleteTrack(track),
      },
    ],
    [
      {
        label: t('fastcat.track.moveUp', 'Move track up'),
        icon: 'lucide:arrow-up',
        disabled: tracks.value.filter(t => t.kind === track.kind)[0]?.id === track.id,
        onSelect: () => timelineStore.moveTrackUp(track.id),
      },
      {
        label: t('fastcat.track.moveDown', 'Move track down'),
        icon: 'lucide:arrow-down',
        disabled: tracks.value.filter(t => t.kind === track.kind).slice(-1)[0]?.id === track.id,
        onSelect: () => timelineStore.moveTrackDown(track.id),
      },
    ],
  ];
}
</script>

<template>
  <UDrawer
    v-model:open="isOpenLocal"
    :direction="isLandscape ? 'right' : 'bottom'"
    :title="$t('fastcat.audioMixer.title', 'Mixer & Tracks')"
  >
    <template #content>
      <div
        class="flex flex-col mx-auto w-full relative"
        :class="isLandscape ? 'max-h-dvh w-[50vw]' : 'max-h-[85dvh] w-full'"
      >
        <div class="flex-1 overflow-y-auto pb-safe px-4 py-4 scrollbar-hide">
          
          <!-- Master Volume -->
          <div class="mb-5 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 shadow-sm relative overflow-hidden shrink-0">
            <div class="absolute inset-0 bg-linear-to-br from-primary-500/5 to-transparent pointer-events-none"></div>
            <div class="flex items-center justify-between mb-3 relative z-10">
              <span class="text-xs font-bold text-slate-100 uppercase tracking-widest">
                {{ $t('fastcat.audioMixer.master', 'Master') }}
              </span>
              <div class="flex items-center gap-3">
                <span class="text-[10px] text-slate-500 font-mono">{{ formatDb(timelineStore.audioLevels?.master?.peakDb) }}</span>
                <UiToggleButton
                  :model-value="isMasterMuted"
                  size="sm"
                  label="M"
                  active-color="error"
                  inactive-color="neutral"
                  inactive-variant="ghost"
                  active-variant="soft"
                  title="Mute master"
                  class="h-6!"
                  @click="toggleMasterMute"
                />
              </div>
            </div>
            <div class="flex items-center gap-3 relative z-10">
              <span class="text-xs text-slate-400 font-medium w-8 tabular-nums">{{ masterVolume }}</span>
              <input
                :value="masterVolume"
                type="range"
                min="0"
                max="400"
                step="1"
                class="flex-1 min-w-0 accent-primary-500"
                @input="updateMasterVolume"
              />
            </div>
          </div>

          <!-- Tracks -->
          <div class="space-y-3">
            <div
              v-for="(track, index) in tracks"
              :key="track.id"
              class="rounded-xl border border-slate-800/80 bg-slate-900/40 p-3 flex flex-col gap-3 transition-colors group"
            >
              <!-- Info & Display row -->
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2 min-w-0 flex-1">
                  <div
                    class="w-6 h-6 rounded shrink-0 flex items-center justify-center font-black text-[10px]"
                    :style="{ 
                      backgroundColor: track.color && track.color !== '#2a2a2a' ? `${track.color}33` : '#1e293b',
                      color: track.color && track.color !== '#2a2a2a' ? track.color : '#94a3b8'
                    }"
                  >
                    {{ track.kind === 'video' ? 'V' : 'A' }}{{ 
                      track.kind === 'video'
                        ? tracks.filter(t => t.kind === 'video').indexOf(track) + 1
                        : tracks.filter(t => t.kind === 'audio').indexOf(track) + 1
                    }}
                  </div>
                  
                  <div v-if="renamingTrackId === track.id" class="flex-1 min-w-0 pr-2">
                    <input
                      v-model="renameValue"
                      class="w-full bg-slate-950 border border-primary-500 text-slate-100 rounded px-2 py-0.5 text-sm font-medium focus:outline-none focus:ring-1 focus:ring-primary-500"
                      autofocus
                      @blur="confirmRename"
                      @keydown.enter="confirmRename"
                      @keydown.esc="renamingTrackId = null"
                    />
                  </div>
                  <span v-else class="text-sm font-medium text-slate-200 truncate pr-2 flex-1" @dblclick="startRename(track)">{{ track.name || track.id }}</span>
                </div>

                <div class="flex items-center gap-0.5 shrink-0 bg-slate-950/50 rounded-lg p-0.5 border border-slate-800/50">
                  <UButton
                    v-if="track.kind === 'video'"
                    :icon="track.videoHidden ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
                    :color="track.videoHidden ? 'primary' : 'neutral'"
                    variant="ghost"
                    size="xs"
                    class="p-1"
                    @click="toggleHide(track.id)"
                  />
                  <UButton
                    :icon="track.locked ? 'i-heroicons-lock-closed' : 'i-heroicons-lock-open'"
                    :color="track.locked ? 'primary' : 'neutral'"
                    variant="ghost"
                    size="xs"
                    class="p-1"
                    @click="toggleLock(track.id)"
                  />
                  <UDropdownMenu :items="getTrackMenuItems(track)" :content="{ align: 'end' }">
                    <UButton
                      icon="lucide:more-vertical"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      class="p-1"
                    />
                  </UDropdownMenu>
                </div>
              </div>

              <!-- Mixer Strip (Solo/Mute + Slider) -->
              <div class="flex items-center gap-2 bg-slate-950/30 rounded-lg p-2 border border-slate-800/30">
                <div class="flex items-center gap-1 shrink-0 bg-slate-900 rounded-md p-0.5 border border-slate-800/50">
                  <UiToggleButton
                    :model-value="Boolean(track.audioSolo)"
                    size="xs"
                    label="S"
                    active-color="primary"
                    inactive-color="neutral"
                    inactive-variant="ghost"
                    active-variant="soft"
                    class="w-6 h-6 p-0! min-w-0"
                    @click="toggleSolo(track.id)"
                  />
                  <UiToggleButton
                    :model-value="Boolean(track.audioMuted)"
                    size="xs"
                    label="M"
                    active-color="error"
                    inactive-color="neutral"
                    inactive-variant="ghost"
                    active-variant="soft"
                    class="w-6 h-6 p-0! min-w-0"
                    @click="toggleMute(track.id)"
                  />
                </div>

                <div class="flex-1 min-w-0 flex items-center gap-2 pl-2 border-l border-slate-800/50">
                  <span class="text-[10px] text-slate-500 font-medium w-6 tabular-nums">{{ Math.round(getTrackGain(track) * 100) }}</span>
                  <input
                    :value="Math.round(getTrackGain(track) * 100)"
                    type="range"
                    min="0"
                    max="400"
                    step="1"
                    class="flex-1 w-full accent-primary-500 h-1.5 bg-slate-800 rounded-lg appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-primary-500 [&::-webkit-slider-thumb]:rounded-full"
                    :disabled="Boolean(track.audioMuted)"
                    :class="{'opacity-40 grayscale pointer-events-none': track.audioMuted}"
                    @input="handleTrackGainInput(track.id, $event)"
                  />
                </div>
              </div>
            </div>
            
            <div class="flex gap-2 pt-3 mt-4 border-t border-slate-800/50">
              <UButton
                icon="i-heroicons-video-camera"
                :label="$t('fastcat.timeline.addVideoTrack', 'Add Video Track')"
                variant="soft"
                color="neutral"
                size="sm"
                class="flex-1 justify-center whitespace-normal h-auto py-2"
                @click="addVideoTrack"
              />
              <UButton
                icon="i-heroicons-musical-note"
                :label="$t('fastcat.timeline.addAudioTrack', 'Add Audio Track')"
                variant="soft"
                color="neutral"
                size="sm"
                class="flex-1 justify-center whitespace-normal h-auto py-2"
                @click="addAudioTrack"
              />
            </div>

          </div>
        </div>
      </div>
      
      <UiConfirmModal
        v-if="selectedTrackForDelete"
        v-model:open="isConfirmDeleteOpen"
        :title="t('fastcat.timeline.deleteTrackTitle', 'Delete track?')"
        :description="t('fastcat.timeline.deleteTrackDescription', 'Track is not empty. This action cannot be undone.')"
        color="error"
        icon="i-heroicons-exclamation-triangle"
        :confirm-text="t('common.delete', 'Delete')"
        @confirm="confirmDelete"
      />
    </template>
  </UDrawer>
</template>

<style scoped>
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 24px);
}
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
