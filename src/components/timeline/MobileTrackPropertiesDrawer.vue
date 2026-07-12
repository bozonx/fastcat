<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTrack } from '~/timeline/types';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import MobilePropertiesDrawer from './MobilePropertiesDrawer.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import { useDrawerToolbarOrientation } from '~/composables/timeline/useDrawerToolbarOrientation';
import { useAppClipboard } from '~/composables/useAppClipboard';
import { useHotkeyLabel } from '~/composables/useHotkeyLabel';

const props = defineProps<{
  isOpen: boolean;
  trackId?: string | null;
  gapItemId?: string | null;
  isTrackHeightEnlarged?: boolean;
}>();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'add-content', trackId: string): void;
  (e: 'toggle-track-height', trackId: string): void;
}>();

const trackHeightIcon = computed(() =>
  props.isTrackHeightEnlarged ? 'i-lucide-fold-vertical' : 'i-lucide-unfold-vertical',
);

const { t } = useI18n();
const { toolbarOrientation } = useDrawerToolbarOrientation();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const clipboardStore = useAppClipboard();
const { getHotkeyTitle } = useHotkeyLabel();
const hasClipboard = computed(() => clipboardStore.hasTimelinePayload);

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

function handlePasteToTrack() {
  if (!selectedTrack.value) return;
  const payload = clipboardStore.clipboardPayload;
  if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;

  let insertStartUs = timelineStore.currentTime;

  if (isGapMode.value && props.gapItemId) {
    const gapItem = selectedTrack.value.items.find((item) => item.id === props.gapItemId);
    if (gapItem && gapItem.kind === 'gap') {
      insertStartUs = gapItem.timelineRange.startUs;
    }
  }

  void timelineStore.pasteClips(payload.items, {
    insertStartUs,
    targetTrackId: selectedTrack.value.id,
  });

  if (payload.operation === 'cut') {
    clipboardStore.setClipboardPayload(null);
  }

  emit('close');
}
</script>

<template>
  <MobilePropertiesDrawer
    v-model:active-snap-point="activeSnapPoint"
    :is-open="props.isOpen"
    @close="emit('close')"
  >
    <template #toolbar>
      <!-- 1. Delete gap (only in gap mode) -->
      <MobileDrawerToolbarButton
        v-if="isGapMode"
        icon="i-heroicons-trash"
        primary
        :label="getHotkeyTitle(t('fastcat.timeline.deleteGap'), 'general.delete')"
        @click="deleteGap"
      />

      <!-- Divider after the gap action -->
      <div
        v-if="isGapMode"
        :class="
          toolbarOrientation === 'vertical'
            ? 'h-px w-6 bg-ui-border my-1.5 self-center shrink-0'
            : 'w-px h-6 bg-ui-border mx-1 self-center shrink-0'
        "
      />

      <!-- Add content -->
      <MobileDrawerToolbarButton
        v-if="selectedTrack"
        icon="i-heroicons-plus"
        success
        :label="t('fastcat.timeline.addContent')"
        @click="selectedTrack && emit('add-content', selectedTrack.id)"
      />

      <!-- Paste content -->
      <MobileDrawerToolbarButton
        v-if="selectedTrack && hasClipboard"
        icon="i-heroicons-clipboard-document-check"
        primary
        :label="t('common.paste')"
        @click="handlePasteToTrack"
      />

      <!-- Toggle track height -->
      <MobileDrawerToolbarButton
        v-if="selectedTrack"
        :icon="trackHeightIcon"
        :active="isTrackHeightEnlarged"
        :label="
          isTrackHeightEnlarged
            ? t('fastcat.timeline.shrinkTrack')
            : t('fastcat.timeline.enlargeTrack')
        "
        @click="selectedTrack && emit('toggle-track-height', selectedTrack.id)"
      />

      <div
        v-if="selectedTrack"
        :class="
          toolbarOrientation === 'vertical'
            ? 'h-px w-6 bg-ui-border my-1.5 self-center shrink-0'
            : 'w-px h-6 bg-ui-border mx-1 self-center shrink-0'
        "
      />

      <!-- 2. Active/disabled (track) -->
      <MobileDrawerToolbarButton
        v-if="selectedTrack?.kind === 'video'"
        :icon="selectedTrack?.videoHidden ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'"
        :active="selectedTrack?.videoHidden"
        status="hidden"
        :label="
          getHotkeyTitle(
            t('videoEditor.hotkeys.timeline.toggleVisibilityTrack'),
            'timeline.toggleVisibilityTrack',
          )
        "
        @click="toggleTrackVideoHidden"
      />

      <!-- 3. Mute (track) -->
      <MobileDrawerToolbarButton
        :icon="
          selectedTrack?.audioMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'
        "
        :active="selectedTrack?.audioMuted"
        status="muted"
        :label="
          getHotkeyTitle(
            t('videoEditor.hotkeys.timeline.toggleMuteTrack'),
            'timeline.toggleMuteTrack',
          )
        "
        @click="toggleTrackMute"
      />

      <!-- 4. Solo (track) -->
      <MobileDrawerToolbarButton
        icon="i-heroicons-musical-note"
        :active="selectedTrack?.audioSolo"
        status="solo"
        :label="
          getHotkeyTitle(
            t('videoEditor.hotkeys.timeline.toggleSoloTrack'),
            'timeline.toggleSoloTrack',
          )
        "
        @click="toggleTrackSolo"
      />

      <!-- 5. Locked (track) -->
      <MobileDrawerToolbarButton
        :icon="selectedTrack?.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'"
        :active="selectedTrack?.locked"
        status="locked"
        :label="
          getHotkeyTitle(
            t('videoEditor.hotkeys.timeline.toggleLockTrack'),
            'timeline.toggleLockTrack',
          )
        "
        @click="toggleTrackLock"
      />

      <!-- 6. Rename (track) -->
      <MobileDrawerToolbarButton
        icon="i-heroicons-pencil-square"
        :label="getHotkeyTitle(t('common.rename'), 'general.rename')"
        @click="isTrackRenameOpen = true"
      />

      <!-- 7. Delete track -->
      <MobileDrawerToolbarButton
        icon="i-heroicons-trash"
        :label="getHotkeyTitle(t('common.delete'), 'general.delete')"
        @click="requestDeleteTrack"
      />
    </template>

    <div v-if="selectedTrack" class="px-4 pb-8 pt-4 flex flex-col gap-4">
      <TrackProperties :track="selectedTrack" is-mobile />
    </div>

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
