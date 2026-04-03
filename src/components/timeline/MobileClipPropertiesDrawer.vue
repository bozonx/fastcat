<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import ClipProperties from '~/components/properties/ClipProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';

const props = defineProps<{
  isOpen: boolean;
}>();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'open-trim-drawer'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const workspaceStore = useWorkspaceStore();
const clipboardStore = useAppClipboard();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

const currentClipAndTrack = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'clip') return null;
  const track = timelineStore.timelineDoc?.tracks?.find((tr) => tr.id === entity.trackId) as
    | TimelineTrack
    | undefined;
  if (!track) return null;
  const item = track.items.find((i) => i.id === entity.itemId) as TimelineClipItem | undefined;
  if (!item || item.kind !== 'clip') return null;
  return { track, item };
});

const clip = computed(() => currentClipAndTrack.value?.item ?? null);
const clipTrack = computed(() => currentClipAndTrack.value?.track ?? null);
const isLocked = computed(() => Boolean(clip.value?.locked || clipTrack.value?.locked));

const isDeleteConfirmOpen = ref(false);

function handleCopy() {
  if (!clip.value) return;
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'copy',
    items: timelineStore.copySelectedClips().map((i) => ({
      sourceTrackId: i.sourceTrackId,
      clip: i.clip,
    })),
  });
}

function handleCut() {
  if (!clip.value || isLocked.value) return;
  clipboardStore.setClipboardPayload({
    source: 'timeline',
    operation: 'cut',
    items: timelineStore.cutSelectedClips().map((i) => ({
      sourceTrackId: i.sourceTrackId,
      clip: i.clip,
    })),
  });
  emit('close');
}

function requestDelete() {
  if (!clip.value || isLocked.value) return;
  if (workspaceStore.userSettings.deleteWithoutConfirmation) {
    timelineStore.deleteFirstSelectedItem();
    emit('close');
  } else {
    isDeleteConfirmOpen.value = true;
  }
}

function confirmDelete() {
  timelineStore.deleteFirstSelectedItem();
  isDeleteConfirmOpen.value = false;
  emit('close');
}

function toggleDisabled() {
  if (!clip.value || !clipTrack.value) return;
  timelineStore.updateClipProperties(clipTrack.value.id, clip.value.id, {
    disabled: !clip.value.disabled,
  });
  timelineStore.requestTimelineSave({ immediate: true });
}

function toggleLocked() {
  if (!clip.value || !clipTrack.value) return;
  timelineStore.updateClipProperties(clipTrack.value.id, clip.value.id, {
    locked: !clip.value.locked,
  });
  timelineStore.requestTimelineSave({ immediate: true });
}

function toggleMuted() {
  if (!clip.value || !clipTrack.value) return;
  timelineStore.updateClipProperties(clipTrack.value.id, clip.value.id, {
    audioMuted: !clip.value.audioMuted,
  });
  timelineStore.requestTimelineSave({ immediate: true });
}

const isSoloed = computed(() => {
  if (!clipTrack.value) return false;
  return clipTrack.value.audioSolo === true;
});

function toggleSolo() {
  if (!clipTrack.value) return;
  timelineStore.updateTrackProperties(clipTrack.value.id, {
    audioSolo: !isSoloed.value,
  });
}

const isRenameModalOpen = ref(false);

function handleRename(newName: string) {
  if (!clip.value || !clipTrack.value) return;
  timelineStore.renameItem(clipTrack.value.id, clip.value.id, newName);
  isRenameModalOpen.value = false;
}

const hasAudio = computed(() => {
  if (!clip.value) return false;
  return (
    clipTrack.value?.kind === 'audio' ||
    clip.value.clipType === 'media' ||
    clip.value.clipType === 'timeline'
  );
});
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    force-landscape-direction="bottom"
  >
    <template #toolbar>
      <MobileDrawerToolbar>
        <MobileDrawerToolbarButton
          icon="i-heroicons-trash"
          :label="t('common.delete', 'Delete')"
          :disabled="isLocked"
          @click="requestDelete"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-pencil"
          :label="t('common.rename', 'Rename')"
          :disabled="isLocked"
          @click="isRenameModalOpen = true"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-document-duplicate"
          :label="t('common.copy', 'Copy')"
          @click="handleCopy"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-scissors"
          :label="t('common.cut', 'Cut')"
          :disabled="isLocked"
          @click="handleCut"
        />

        <MobileDrawerToolbarButton
          :icon="clip?.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
          :label="
            clip?.disabled
              ? t('fastcat.timeline.enableClip', 'Enable')
              : t('fastcat.timeline.disableClip', 'Disable')
          "
          :active="clip?.disabled"
          @click="toggleDisabled"
        />

        <template v-if="hasAudio">
          <MobileDrawerToolbarButton
            :icon="clip?.audioMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark'"
            :label="
              clip?.audioMuted
                ? t('fastcat.timeline.unmuteClip', 'Unmute')
                : t('fastcat.timeline.muteClip', 'Mute')
            "
            :active="clip?.audioMuted"
            @click="toggleMuted"
          />

          <MobileDrawerToolbarButton
            :icon="isSoloed ? 'i-heroicons-star-solid' : 'i-heroicons-star'"
            :label="isSoloed ? t('fastcat.timeline.unsolo', 'Unsolo') : t('fastcat.timeline.solo', 'Solo')"
            :active="isSoloed"
            @click="toggleSolo"
          />
        </template>

        <MobileDrawerToolbarButton
          :icon="clip?.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'"
          :label="
            clip?.locked
              ? t('fastcat.timeline.unlockClip', 'Unlock')
              : t('fastcat.timeline.lockClip', 'Lock')
          "
          :active="clip?.locked"
          @click="toggleLocked"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-arrows-right-left"
          :label="t('fastcat.timeline.trimMode', 'Trim')"
          :disabled="isLocked"
          @click="$emit('open-trim-drawer')"
        />
      </MobileDrawerToolbar>
    </template>

    <div v-if="clip" class="px-4 pt-4 pb-8">
      <ClipProperties :clip="clip" />
    </div>

    <UiConfirmModal
      v-model:open="isDeleteConfirmOpen"
      :title="t('fastcat.timeline.deleteClipTitle', 'Delete clip?')"
      :description="t('fastcat.timeline.deleteClipDescription', 'This action cannot be undone.')"
      color="primary"
      icon="i-heroicons-exclamation-triangle"
      :confirm-text="t('common.delete', 'Delete')"
      @confirm="confirmDelete"
    />

    <UiRenameModal
      :open="isRenameModalOpen"
      :current-name="clip?.name ?? ''"
      :title="t('fastcat.clip.rename', 'Rename clip')"
      @update:open="isRenameModalOpen = $event"
      @rename="handleRename"
    />
  </MobileTimelineDrawer>
</template>
