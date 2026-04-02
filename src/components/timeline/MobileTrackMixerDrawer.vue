<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTrack } from '~/timeline/types';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import { linearToDb, dbToLinear } from '~/utils/audio';
import DbSlider from '~/components/audio/DbSlider.vue';

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

const tracks = computed(() => (timelineStore.timelineDoc?.tracks as TimelineTrack[]) ?? []);

const selectedTrackForPropertiesId = ref<string | null>(null);
const selectedTrackForProperties = computed(() =>
  tracks.value.find((t) => t.id === selectedTrackForPropertiesId.value),
);

watch(isOpenLocal, (val) => {
  if (!val) {
    setTimeout(() => {
      selectedTrackForPropertiesId.value = null;
    }, 300);
  }
});

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

function handleTrackGainDbInput(trackId: string, dbVal: number) {
  timelineStore.updateTrackProperties(trackId, {
    audioGain: dbToLinear(dbVal),
  });
}

function getTrackGain(track: TimelineTrack) {
  return typeof track.audioGain === 'number' ? track.audioGain : 1;
}

const masterVolumeDb = computed({
  get: () => linearToDb(timelineStore.masterGain ?? 1),
  set: (value: number) => {
    timelineStore.setMasterGain(dbToLinear(value));
  },
});

const isMasterMuted = computed(() => timelineStore.audioMuted);

function toggleMasterMute() {
  timelineStore.audioMuted = !timelineStore.audioMuted;
}

function formatDb(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} dB`;
}

function addVideoTrack() {
  const videoCount = tracks.value.filter((t) => t.kind === 'video').length;
  timelineStore.addTrack('video', `Video ${videoCount + 1}`);
}

function addAudioTrack() {
  const audioCount = tracks.value.filter((t) => t.kind === 'audio').length;
  timelineStore.addTrack('audio', `Audio ${audioCount + 1}`);
}

const isConfirmDeleteOpen = ref(false);
const trackToDeleteId = ref<string | null>(null);
const selectedTrackForDelete = computed(() =>
  tracks.value.find((t) => t.id === trackToDeleteId.value),
);

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
    const track = tracks.value.find((t) => t.id === renamingTrackId.value);
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
        label: track.locked
          ? t('fastcat.track.unlock', 'Unlock track')
          : t('fastcat.track.lock', 'Lock track'),
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
        disabled: tracks.value.filter((t) => t.kind === track.kind)[0]?.id === track.id,
        onSelect: () => timelineStore.moveTrackUp(track.id),
      },
      {
        label: t('fastcat.track.moveDown', 'Move track down'),
        icon: 'lucide:arrow-down',
        disabled: tracks.value.filter((t) => t.kind === track.kind).slice(-1)[0]?.id === track.id,
        onSelect: () => timelineStore.moveTrackDown(track.id),
      },
    ],
  ];
}
</script>

<template>
  <UiMobileDrawer
    v-model:open="isOpenLocal"
    :title="
      selectedTrackForProperties
        ? $t('common.properties', 'Properties')
        : $t('fastcat.audioMixer.title', 'Mixer & Tracks')
    "
    :ui="{ body: 'no-scrollbar' }"
  >
    <div
      v-if="selectedTrackForProperties"
      class="flex flex-col animate-in fade-in slide-in-from-right-4 duration-200"
    >
      <div
        class="sticky top-0 z-20 bg-ui-bg-elevated/95 backdrop-blur border-b border-ui-border p-2 flex items-center gap-2 mb-2"
      >
        <UButton
          icon="i-heroicons-chevron-left"
          variant="ghost"
          color="neutral"
          size="sm"
          @click="selectedTrackForPropertiesId = null"
        />
        <span class="font-medium text-sm text-ui-text line-clamp-1">{{
          selectedTrackForProperties.name || selectedTrackForProperties.id
        }}</span>
      </div>
      <div class="px-4 pb-4">
        <TrackProperties :track="selectedTrackForProperties" />
      </div>
    </div>

    <div
      v-else
      class="px-4 py-4 animate-in fade-in slide-in-from-left-4 duration-200 flex flex-col h-full overflow-hidden"
    >
      <!-- Tracks Container with Horizontal Scroll -->
      <div
        class="flex gap-4 overflow-x-auto pb-4 no-scrollbar items-stretch flex-1 hide-scrollbar snap-x snap-mandatory"
      >
        <!-- Individual Tracks -->
        <div
          v-for="track in tracks"
          :key="track.id"
          class="shrink-0 w-32 rounded-xl border border-slate-800/80 bg-slate-900/40 p-3 flex flex-col transition-colors group snap-start relative"
        >
          <!-- Top: Info & Display row -->
          <div class="flex flex-col items-center mb-3 gap-2">
            <div
              class="w-8 h-8 rounded shrink-0 flex items-center justify-center font-black text-xs"
              :style="{
                backgroundColor:
                  track.color && track.color !== '#2a2a2a' ? `${track.color}33` : '#1e293b',
                color: track.color && track.color !== '#2a2a2a' ? track.color : '#94a3b8',
              }"
            >
              {{ track.kind === 'video' ? 'V' : 'A'
              }}{{
                track.kind === 'video'
                  ? tracks.filter((t) => t.kind === 'video').indexOf(track) + 1
                  : tracks.filter((t) => t.kind === 'audio').indexOf(track) + 1
              }}
            </div>

            <div v-if="renamingTrackId === track.id" class="w-full">
              <input
                v-model="renameValue"
                class="w-full bg-slate-950 border border-primary-500 text-slate-100 rounded px-1 py-0.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary-500 text-center"
                autofocus
                @blur="confirmRename"
                @keydown.enter="confirmRename"
                @keydown.esc="renamingTrackId = null"
              />
            </div>
            <span
              v-else
              class="text-xs font-medium text-slate-200 truncate w-full text-center px-1 cursor-text"
              @dblclick="startRename(track)"
            >
              {{ track.name || track.id }}
            </span>

            <div
              class="flex flex-wrap justify-center gap-0.5 mt-1 bg-slate-950/50 rounded-lg p-0.5 border border-slate-800/50 w-full"
            >
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
              <UButton
                icon="lucide:settings"
                color="neutral"
                variant="ghost"
                size="xs"
                class="p-1"
                title="Track Properties"
                @click="selectedTrackForPropertiesId = track.id"
              />
            </div>
          </div>

          <!-- Middle: Vertical Volume Slider -->
          <div
            class="flex-1 w-full min-h-[200px] flex justify-center py-2 relative"
            :class="{ 'opacity-50 grayscale pointer-events-none': track.audioMuted }"
          >
            <DbSlider
              :model-value="linearToDb(getTrackGain(track))"
              :level-db="timelineStore.audioLevels?.[track.id]?.peakDb"
              @update:model-value="handleTrackGainDbInput(track.id, $event)"
            />
          </div>

          <!-- Bottom: Solo & Mute -->
          <div class="flex justify-center gap-2 mt-3 pt-3 border-t border-slate-800/50">
            <UiToggleButton
              :model-value="Boolean(track.audioSolo)"
              size="xs"
              label="S"
              active-color="primary"
              inactive-color="neutral"
              inactive-variant="ghost"
              active-variant="soft"
              class="w-8 h-8"
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
              class="w-8 h-8"
              @click="toggleMute(track.id)"
            />
          </div>
        </div>

        <!-- Master Volume (Horizontal scroll item) -->
        <div
          class="shrink-0 w-32 rounded-xl border border-slate-800 bg-slate-900/60 p-3 shadow-sm relative overflow-hidden flex flex-col snap-start"
        >
          <div
            class="absolute inset-0 bg-linear-to-br from-primary-500/5 to-transparent pointer-events-none"
          ></div>

          <div class="flex flex-col items-center mb-3 relative z-10">
            <span
              class="text-xs font-bold text-slate-100 uppercase tracking-widest mb-1 text-center w-full truncate"
            >
              {{ $t('fastcat.audioMixer.master', 'Master') }}
            </span>
            <span class="text-[10px] text-slate-500 font-mono">{{
              formatDb(timelineStore.audioLevels?.master?.peakDb)
            }}</span>
          </div>

          <!-- Middle: Vertical Master Slider -->
          <div class="flex-1 w-full min-h-[200px] flex justify-center py-2 relative z-10">
            <DbSlider
              v-model="masterVolumeDb"
              :level-db="timelineStore.audioLevels?.master?.peakDb"
            />
          </div>

          <div
            class="flex justify-center gap-2 mt-3 pt-3 border-t border-slate-800/50 relative z-10"
          >
            <UiToggleButton
              :model-value="isMasterMuted"
              size="xs"
              label="M"
              active-color="error"
              inactive-color="neutral"
              inactive-variant="ghost"
              active-variant="soft"
              title="Mute master"
              class="w-8 h-8"
              @click="toggleMasterMute"
            />
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-2 pt-4 mt-1 border-t border-slate-800/50 shrink-0">
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

    <UiConfirmModal
      v-if="selectedTrackForDelete"
      v-model:open="isConfirmDeleteOpen"
      :title="t('fastcat.timeline.deleteTrackTitle', 'Delete track?')"
      :description="
        t(
          'fastcat.timeline.deleteTrackDescription',
          'Track is not empty. This action cannot be undone.',
        )
      "
      color="error"
      icon="i-heroicons-exclamation-triangle"
      :confirm-text="t('common.delete', 'Delete')"
      @confirm="confirmDelete"
    />
  </UiMobileDrawer>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
