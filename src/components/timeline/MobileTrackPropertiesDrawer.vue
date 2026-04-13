<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTrack } from '~/timeline/types';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import GenerateCaptionsModal from '~/components/properties/GenerateCaptionsModal.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';

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

const isGenerateCaptionsOpen = ref(false);

const extraActions = computed(() => {
  if (!selectedTrack.value) return [];
  const list: any[] = [];
  if (selectedTrack.value.kind === 'video') {
    list.push({
      id: 'generate-captions',
      label: t('fastcat.captions.generate'),
      icon: 'i-heroicons-chat-bubble-bottom-center-text',
      onClick: () => (isGenerateCaptionsOpen.value = true),
    });
  }
  return list;
});
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    with-toolbar-snap
  >
    <template #toolbar>
      <MobileDrawerToolbar class="border-b border-ui-border">
        <MobileDrawerToolbarButton
          icon="i-heroicons-trash"
          :label="t('common.delete')"
          @click="requestDeleteTrack"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-pencil-square"
          :label="t('common.rename')"
          @click="isTrackRenameOpen = true"
        />

        <MobileDrawerToolbarButton
          :icon="selectedTrack?.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'"
          :label="selectedTrack?.locked ? t('fastcat.track.unlock') : t('fastcat.track.lock')"
          :active="selectedTrack?.locked"
          @click="toggleTrackLock"
        />

        <MobileDrawerToolbarButton
          v-if="selectedTrack?.kind === 'video'"
          :icon="selectedTrack?.videoHidden ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
          :label="
            selectedTrack?.videoHidden
              ? t('fastcat.timeline.showTrack')
              : t('fastcat.timeline.hideTrack')
          "
          :active="selectedTrack?.videoHidden"
          @click="toggleTrackVideoHidden"
        />

        <MobileDrawerToolbarButton
          :icon="
            selectedTrack?.audioMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'
          "
          :label="selectedTrack?.audioMuted ? t('fastcat.track.unmute') : t('fastcat.track.mute')"
          :active="selectedTrack?.audioMuted"
          @click="toggleTrackMute"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-musical-note"
          :label="t('fastcat.track.solo')"
          :active="selectedTrack?.audioSolo"
          @click="toggleTrackSolo"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-arrow-up"
          :label="t('fastcat.track.moveUp')"
          :disabled="isTrackFirstOfKind"
          @click="moveSelectedTrackUp"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-arrow-down"
          :label="t('fastcat.track.moveDown')"
          :disabled="isTrackLastOfKind"
          @click="moveSelectedTrackDown"
        />
      </MobileDrawerToolbar>
    </template>

    <div v-if="selectedTrack" class="px-4 pb-8 pt-4 flex flex-col gap-4">
      <div
        v-if="extraActions.length > 0"
        class="py-1 px-3 border border-ui-border rounded-xl bg-zinc-900/40"
      >
        <PropertyActionList :actions="extraActions" vertical variant="ghost" size="md" />
      </div>

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

      <TrackProperties :track="selectedTrack" hide-actions />
    </div>

    <GenerateCaptionsModal
      v-if="selectedTrack?.kind === 'video'"
      v-model:open="isGenerateCaptionsOpen"
      :track-id="selectedTrack.id"
    />

    <UiConfirmModal
      v-model:open="isTrackDeleteConfirmOpen"
      :title="t('fastcat.timeline.deleteTrackTitle')"
      :description="
        t(
          'fastcat.timeline.deleteTrackDescription',
          'Track is not empty. This action cannot be undone.',
        )
      "
      color="primary"
      icon="i-heroicons-exclamation-triangle"
      :confirm-text="t('common.delete')"
      @confirm="confirmDeleteTrack"
    />

    <UiRenameModal
      :open="isTrackRenameOpen"
      :current-name="selectedTrack?.name || ''"
      :title="t('fastcat.timeline.renameTrack')"
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
