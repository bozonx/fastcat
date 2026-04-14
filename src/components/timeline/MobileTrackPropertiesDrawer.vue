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

const sameKindTracks = computed(() => {
  if (!selectedTrack.value) return [];
  return tracks.value.filter((track) => track.kind === selectedTrack.value!.kind);
});

const nextTrackIndex = computed(() => sameKindTracks.value.length + 1);

const isTrackDeleteConfirmOpen = ref(false);
const isTrackRenameOpen = ref(false);

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

function createTrack(options: { insertBeforeId?: string; insertAfterId?: string }) {
  if (!selectedTrack.value) return;
  const nextName = `${selectedTrack.value.kind === 'video' ? 'Video' : 'Audio'} ${nextTrackIndex.value}`;
  timelineStore.addTrack(selectedTrack.value.kind, nextName, options);
}

function requestDeleteTrack() {
  if (!selectedTrack.value) return;
  const skipConfirm = workspaceStore.userSettings.deleteWithoutConfirmation;
  if (selectedTrack.value.items.length === 0 || skipConfirm) {
    timelineStore.deleteTrack(selectedTrack.value.id, { allowNonEmpty: true });
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
  const list: Array<{
    id: string;
    label: string;
    icon: string;
    onClick: () => void;
    disabled?: boolean;
  }> = [];
  if (selectedTrack.value.kind === 'video') {
    list.push({
      id: 'generate-captions',
      label: t('fastcat.captions.generate'),
      icon: 'i-heroicons-chat-bubble-bottom-center-text',
      onClick: () => (isGenerateCaptionsOpen.value = true),
    });
  }

  list.push(
    {
      id: 'create-above',
      label: t(
        `fastcat.timeline.add${selectedTrack.value.kind === 'video' ? 'Video' : 'Audio'}TrackAbove`,
      ),
      icon:
        selectedTrack.value.kind === 'video'
          ? 'i-heroicons-video-camera'
          : 'i-heroicons-musical-note',
      onClick: () => createTrack({ insertBeforeId: selectedTrack.value!.id }),
    },
    {
      id: 'create-below',
      label: t(
        `fastcat.timeline.add${selectedTrack.value.kind === 'video' ? 'Video' : 'Audio'}TrackBelow`,
      ),
      icon:
        selectedTrack.value.kind === 'video'
          ? 'i-heroicons-video-camera'
          : 'i-heroicons-musical-note',
      onClick: () => createTrack({ insertAfterId: selectedTrack.value!.id }),
    },
    {
      id: 'move-up',
      label: t('fastcat.track.moveUp'),
      icon: 'i-heroicons-arrow-up',
      disabled: isTrackFirstOfKind.value,
      onClick: moveSelectedTrackUp,
    },
    {
      id: 'move-down',
      label: t('fastcat.track.moveDown'),
      icon: 'i-heroicons-arrow-down',
      disabled: isTrackLastOfKind.value,
      onClick: moveSelectedTrackDown,
    },
  );

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
      </MobileDrawerToolbar>
    </template>

    <div v-if="selectedTrack" class="px-4 pb-8 pt-4 flex flex-col gap-4">
      <div v-if="extraActions.length > 0" class="grid grid-cols-2 gap-3">
        <MobileDrawerToolbarButton
          v-for="action in extraActions"
          :key="action.id"
          :icon="action.icon"
          :label="action.label"
          :disabled="action.disabled"
          @click="action.onClick"
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
      :description="t('fastcat.timeline.deleteTrackDescription')"
      color="error"
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
