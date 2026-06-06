<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTrack } from '~/timeline/types';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import GenerateCaptionsModal from '~/components/properties/GenerateCaptionsModal.vue';
import MobilePropertiesDrawer from './MobilePropertiesDrawer.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import { useTrackExtraActions } from '~/composables/properties/useTrackExtraActions';

const props = defineProps<{
  isOpen: boolean;
  trackId?: string | null;
  gapItemId?: string | null;
}>();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();

const tracks = computed(
  () => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [],
);

const selectedTrackId = computed(() => props.trackId ?? timelineStore.selectedTrackId);

const selectedTrack = computed(() => {
  if (!selectedTrackId.value) return null;
  return tracks.value.find((t) => t.id === selectedTrackId.value) || null;
});

const isGapMode = computed(() => Boolean(props.gapItemId));

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

function deleteGap() {
  if (!selectedTrack.value || !props.gapItemId) return;

  timelineStore.applyTimeline({
    type: 'delete_items',
    trackId: selectedTrack.value.id,
    itemIds: [props.gapItemId],
  });
  timelineStore.clearSelection();
  emit('close');
}

const isGenerateCaptionsOpen = ref(false);

const { extraActions } = useTrackExtraActions({
  track: selectedTrack,
  timelineStore,
  onGenerateCaptions: () => (isGenerateCaptionsOpen.value = true),
});
</script>

<template>
  <MobilePropertiesDrawer
    v-model:active-snap-point="activeSnapPoint"
    :is-open="props.isOpen"
    @close="emit('close')"
  >
    <template #toolbar>
        <MobileDrawerToolbarButton
          icon="i-heroicons-trash"
          @click="isGapMode ? deleteGap() : requestDeleteTrack()"
        />

        <MobileDrawerToolbarButton
          v-if="isGapMode"
          icon="i-heroicons-trash"
          @click="requestDeleteTrack"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-pencil-square"
          :label="t('common.rename')"
          @click="isTrackRenameOpen = true"
        />

        <MobileDrawerToolbarButton
          :icon="selectedTrack?.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'"
          :active="selectedTrack?.locked"
          @click="toggleTrackLock"
        />

        <MobileDrawerToolbarButton
          v-if="selectedTrack?.kind === 'video'"
          :icon="selectedTrack?.videoHidden ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
          :active="selectedTrack?.videoHidden"
          @click="toggleTrackVideoHidden"
        />

        <MobileDrawerToolbarButton
          :icon="
            selectedTrack?.audioMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'
          "
          :active="selectedTrack?.audioMuted"
          @click="toggleTrackMute"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-musical-note"
          :active="selectedTrack?.audioSolo"
          @click="toggleTrackSolo"
        />
    </template>

    <div v-if="selectedTrack" class="px-4 pb-8 pt-4 flex flex-col gap-4">
      <div
        v-if="extraActions.length > 0"
        class="py-1 px-3 border border-ui-border rounded-xl bg-ui-bg-elevated/40"
      >
        <PropertyActionList :actions="extraActions" vertical variant="ghost" size="md" />
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
  </MobilePropertiesDrawer>
</template>
