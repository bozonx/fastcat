<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTrack } from '~/timeline/types';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';

const props = defineProps<{
  isOpen: boolean;
}>();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

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

const tracks = computed(
  () => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [],
);

const selectedTrack = computed(() => {
  if (!timelineStore.selectedTrackId) return null;
  return tracks.value.find((t) => t.id === timelineStore.selectedTrackId) || null;
});

const selectedTrackNumber = computed(() => {
  if (!selectedTrack.value) return 1;
  const filtered = tracks.value.filter((t) => t.kind === selectedTrack.value!.kind);
  return filtered.indexOf(selectedTrack.value) + 1;
});

const isTrackFirstOfKind = computed(() => {
  if (!selectedTrack.value) return true;
  return (
    tracks.value.filter((t) => t.kind === selectedTrack.value!.kind)[0]?.id ===
    selectedTrack.value.id
  );
});

const isTrackLastOfKind = computed(() => {
  if (!selectedTrack.value) return true;
  const kindTracks = tracks.value.filter((t) => t.kind === selectedTrack.value!.kind);
  return kindTracks[kindTracks.length - 1]?.id === selectedTrack.value.id;
});

const trackGain = computed(() => {
  if (!selectedTrack.value) return 100;
  const gain =
    typeof selectedTrack.value.audioGain === 'number' ? selectedTrack.value.audioGain : 1;
  return Math.round(Math.max(0, Math.min(4, gain)) * 100);
});

const isTrackDeleteConfirmOpen = ref(false);
const isTrackRenameOpen = ref(false);

function handleTrackGainInput(event: Event) {
  if (!selectedTrack.value) return;
  const val = (event.target as HTMLInputElement).valueAsNumber;
  timelineStore.updateTrackProperties(selectedTrack.value.id, {
    audioGain: Math.max(0, Math.min(4, val / 100)),
  });
}

function toggleTrackLock() {
  if (!selectedTrack.value) return;
  timelineStore.updateTrackProperties(selectedTrack.value.id, {
    locked: !selectedTrack.value.locked,
  });
  timelineStore.requestTimelineSave({ immediate: true });
}

function toggleTrackVideoHidden() {
  if (!selectedTrack.value) return;
  timelineStore.updateTrackProperties(selectedTrack.value.id, {
    videoHidden: !selectedTrack.value.videoHidden,
  });
  timelineStore.requestTimelineSave({ immediate: true });
}

function toggleTrackMute() {
  if (!selectedTrack.value) return;
  timelineStore.toggleTrackAudioMuted(selectedTrack.value.id);
  timelineStore.requestTimelineSave({ immediate: true });
}

function toggleTrackSolo() {
  if (!selectedTrack.value) return;
  timelineStore.toggleTrackAudioSolo(selectedTrack.value.id);
  timelineStore.requestTimelineSave({ immediate: true });
}

function moveSelectedTrackUp() {
  if (!selectedTrack.value) return;
  timelineStore.moveTrackUp(selectedTrack.value.id);
}

function moveSelectedTrackDown() {
  if (!selectedTrack.value) return;
  timelineStore.moveTrackDown(selectedTrack.value.id);
}

function requestDeleteTrack() {
  if (!selectedTrack.value) return;
  const skipConfirm = workspaceStore.userSettings.deleteWithoutConfirmation;
  if (selectedTrack.value.items.length === 0 || skipConfirm) {
    timelineStore.deleteTrack(selectedTrack.value.id);
    emit('close');
  } else {
    isTrackDeleteConfirmOpen.value = true;
  }
}

function confirmDeleteTrack() {
  if (!selectedTrack.value) return;
  timelineStore.deleteTrack(selectedTrack.value.id, { allowNonEmpty: true });
  isTrackDeleteConfirmOpen.value = false;
  emit('close');
}
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    force-landscape-direction="bottom"
  >
    <template #toolbar>
      <MobileDrawerToolbar>
        <!-- Delete -->
        <MobileDrawerToolbarButton
          icon="i-heroicons-trash"
          :label="t('common.delete', 'Delete')"
          @click="requestDeleteTrack"
        />

        <!-- Rename -->
        <MobileDrawerToolbarButton
          icon="i-heroicons-pencil-square"
          :label="t('common.rename', 'Rename')"
          @click="isTrackRenameOpen = true"
        />

        <!-- Lock / Unlock -->
        <MobileDrawerToolbarButton
          :icon="selectedTrack?.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'"
          :label="
            selectedTrack?.locked
              ? t('fastcat.track.unlock', 'Unlock')
              : t('fastcat.track.lock', 'Lock')
          "
          :active="selectedTrack?.locked"
          @click="toggleTrackLock"
        />

        <!-- Hide / Show (video only) -->
        <MobileDrawerToolbarButton
          v-if="selectedTrack?.kind === 'video'"
          :icon="selectedTrack?.videoHidden ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
          :label="
            selectedTrack?.videoHidden
              ? t('fastcat.timeline.showTrack', 'Show')
              : t('fastcat.timeline.hideTrack', 'Hide')
          "
          :active="selectedTrack?.videoHidden"
          @click="toggleTrackVideoHidden"
        />

        <!-- Mute / Unmute -->
        <MobileDrawerToolbarButton
          :icon="
            selectedTrack?.audioMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'
          "
          :label="
            selectedTrack?.audioMuted
              ? t('fastcat.track.unmute', 'Unmute')
              : t('fastcat.track.mute', 'Mute')
          "
          :active="selectedTrack?.audioMuted"
          @click="toggleTrackMute"
        />

        <!-- Solo -->
        <MobileDrawerToolbarButton
          icon="i-heroicons-musical-note"
          :label="t('fastcat.track.solo', 'Solo')"
          :active="selectedTrack?.audioSolo"
          @click="toggleTrackSolo"
        />

        <!-- Move Up -->
        <MobileDrawerToolbarButton
          icon="i-heroicons-arrow-up"
          :label="t('fastcat.track.moveUp', 'Move up')"
          :disabled="isTrackFirstOfKind"
          @click="moveSelectedTrackUp"
        />

        <!-- Move Down -->
        <MobileDrawerToolbarButton
          icon="i-heroicons-arrow-down"
          :label="t('fastcat.track.moveDown', 'Move down')"
          :disabled="isTrackLastOfKind"
          @click="moveSelectedTrackDown"
        />
      </MobileDrawerToolbar>
    </template>

    <div v-if="selectedTrack" class="px-4 pt-4 pb-8 flex flex-col gap-4">
      <!-- Track volume slider -->
      <div
        class="flex items-center gap-3 rounded-xl bg-zinc-900/80 border border-zinc-800 px-3 py-2.5"
      >
        <UIcon name="i-heroicons-speaker-wave" class="w-4 h-4 text-zinc-400 shrink-0" />
        <span class="text-xs text-zinc-400 font-mono w-8 tabular-nums text-right shrink-0">
          {{ trackGain }}
        </span>
        <input
          :value="trackGain"
          type="range"
          min="0"
          max="400"
          step="1"
          class="flex-1 accent-primary-500"
          :disabled="Boolean(selectedTrack.audioMuted)"
          :class="{ 'opacity-40 pointer-events-none': selectedTrack.audioMuted }"
          @input="handleTrackGainInput"
        />
      </div>

      <TrackProperties :track="selectedTrack" />
    </div>

    <UiConfirmModal
      v-model:open="isTrackDeleteConfirmOpen"
      :title="t('fastcat.timeline.deleteTrackTitle', 'Delete track?')"
      :description="
        t(
          'fastcat.timeline.deleteTrackDescription',
          'Track is not empty. This action cannot be undone.',
        )
      "
      color="primary"
      icon="i-heroicons-exclamation-triangle"
      :confirm-text="t('common.delete', 'Delete')"
      @confirm="confirmDeleteTrack"
    />

    <UiRenameModal
      :open="isTrackRenameOpen"
      :current-name="selectedTrack?.name || ''"
      :title="t('fastcat.timeline.renameTrack', 'Rename track')"
      @update:open="isTrackRenameOpen = $event"
      @rename="
        (name) => {
          if (selectedTrack) timelineStore.renameTrack(selectedTrack.id, name);
          isTrackRenameOpen = false;
        }
      "
    />
  </MobileTimelineDrawer>
</template>
