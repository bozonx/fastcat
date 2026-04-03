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
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { useMediaStore } from '~/stores/media.store';
import { useUiStore } from '~/stores/ui.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useProjectStore } from '~/stores/project.store';

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
const mediaStore = useMediaStore();
const uiStore = useUiStore();
const fileManagerStore = useFileManagerStore();
const focusStore = useFocusStore();
const fileManager = useFileManager();
const { setActiveTab } = useProjectTabsStore();
const projectStore = useProjectStore();

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
const clipTrackKind = computed(() => clipTrack.value?.kind ?? 'video');
const isLocked = computed(() => Boolean(clip.value?.locked || clipTrack.value?.locked));

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
  timelineStore.deleteFirstSelectedItem();
  emit('close');
}

function requestRippleDelete() {
  if (!clip.value || isLocked.value) return;
  timelineStore.rippleDeleteFirstSelectedItem();
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

const {
  isFreePosition,
  hasLockedLinkedAudio,
  isLockedLinkedAudioClip,
  isInLinkedGroup,
  handleDeleteClip,
  handleUnlinkAudio,
  handleQuantizeClip,
  handleRemoveFromGroup,
  toggleAudioWaveformMode,
  toggleShowWaveform,
  toggleShowThumbnails,
  handleSelectInFileManager,
  handleOpenNestedTimeline,
  goToLinkedAudio,
  goToLinkedVideo,
  linkedAudioClip,
  linkedVideoClip,
} = useClipPropertiesActions({
  clip: clip as any,
  trackKind: clipTrackKind as any,
  timelineStore: timelineStore as any,
  projectStore: projectStore as any,
  uiStore: uiStore as any,
  fileManagerStore: fileManagerStore as any,
  selectionStore: selectionStore as any,
  focusStore: focusStore as any,
  fileManager: fileManager as any,
  setActiveTab,
});

const isMediaVideoClip = computed(() => {
  return clipTrackKind.value === 'video' && clip.value?.clipType === 'media';
});

const hasFreezeFrame = computed(() => {
  return typeof clip.value?.freezeFrameSourceUs === 'number';
});

const canExtractAudio = computed(() => {
  return (
    clipTrackKind.value === 'video' &&
    clip.value?.clipType === 'media' &&
    !(clip.value as any).audioFromVideoDisabled
  );
});

const hasReturnFromVideoClip = computed(() => {
  return clipTrackKind.value === 'video' && Boolean(clip.value?.audioFromVideoDisabled);
});

const hasReturnFromLockedAudioClip = computed(() => {
  return (
    clipTrackKind.value === 'audio' &&
    Boolean(clip.value?.linkedVideoClipId) &&
    Boolean(clip.value?.lockToLinkedVideo)
  );
});

async function handleExtractAudio() {
  if (!clip.value || !clipTrack.value) return;
  await timelineStore.extractAudioToTrack({
    videoTrackId: clipTrack.value.id,
    videoItemId: clip.value.id,
  });
  await timelineStore.requestTimelineSave({ immediate: true });
}

function handleReturnAudio() {
  if (!clip.value) return;
  if (clip.value.linkedVideoClipId) {
    timelineStore.returnAudioToVideo({ videoItemId: clip.value.linkedVideoClipId });
  } else {
    timelineStore.returnAudioToVideo({ videoItemId: clip.value.id });
  }
  timelineStore.requestTimelineSave({ immediate: true });
}

function handleFreezeFrame() {
  if (!clip.value || !clipTrack.value) return;
  const playheadUs = timelineStore.currentTime;
  const clipStartUs = clip.value.timelineRange.startUs;
  const relativeUs = playheadUs - clipStartUs;
  const clampedUs = Math.max(0, Math.min(relativeUs, clip.value.timelineRange.durationUs));
  timelineStore.updateClipProperties(clipTrack.value.id, clip.value.id, {
    freezeFrameSourceUs: Math.round(clampedUs),
  });
}

function handleResetFreezeFrame() {
  if (!clip.value || !clipTrack.value) return;
  timelineStore.updateClipProperties(clipTrack.value.id, clip.value.id, {
    freezeFrameSourceUs: undefined,
  });
}

const otherActions = computed(() => {
  const list: any[] = [];
  if (!clip.value) return list;

  if (isFreePosition.value) {
    list.push({
      id: 'quantize',
      label: t('fastcat.timeline.quantize', 'Quantize to frames'),
      icon: 'i-heroicons-squares-2x2',
      onClick: handleQuantizeClip,
    });
  }

  if (linkedAudioClip.value) {
    list.push({
      id: 'goToLinkedAudio',
      label: t('fastcat.clip.goToLinkedAudio', 'Go to linked audio'),
      icon: 'i-heroicons-speaker-wave',
      color: 'primary',
      onClick: goToLinkedAudio,
    });
  }

  if (linkedVideoClip.value) {
    list.push({
      id: 'goToLinkedVideo',
      label: t('fastcat.clip.goToLinkedVideo', 'Go to linked video'),
      icon: 'i-heroicons-film',
      color: 'primary',
      onClick: goToLinkedVideo,
    });
  }

  if (hasLockedLinkedAudio.value || isLockedLinkedAudioClip.value) {
    list.push({
      id: 'unlinkAudio',
      label: t('fastcat.timeline.unlinkAudio', 'Unlink audio'),
      icon: 'i-heroicons-link-slash',
      onClick: handleUnlinkAudio,
    });
  }

  if (isInLinkedGroup.value) {
    list.push({
      id: 'removeFromGroup',
      label: t('fastcat.timeline.removeFromGroup', 'Remove from group'),
      icon: 'i-heroicons-link-slash',
      onClick: handleRemoveFromGroup,
    });
  }

  if (clip.value.clipType === 'media') {
    list.push({
      id: 'showInFileManager',
      label: t('fastcat.clip.showInFileManager', 'Show in File Manager'),
      icon: 'i-heroicons-folder-open',
      onClick: handleSelectInFileManager,
    });
  }

  if (clip.value.clipType === 'timeline') {
    list.push({
      id: 'goToTimeline',
      label: t('fastcat.clip.goToTimeline', 'Go to timeline'),
      icon: 'i-heroicons-arrow-right-circle',
      onClick: handleOpenNestedTimeline,
    });
  }

  if (hasAudio.value) {
    list.push({
      id: 'toggleAudioWaveformMode',
      label:
        (clip.value.audioWaveformMode || 'half') === 'full'
          ? t('fastcat.clip.halfWaveform', 'Half Waveform')
          : t('fastcat.clip.fullWaveform', 'Full Waveform'),
      icon: 'i-heroicons-chart-bar',
      onClick: toggleAudioWaveformMode,
    });
  }

  if (clipTrackKind.value === 'video' || clipTrackKind.value === 'audio') {
    list.push({
      id: 'toggleShowWaveform',
      label:
        clip.value.showWaveform === false
          ? t('fastcat.clip.showWaveform', 'Show Waveform')
          : t('fastcat.clip.hideWaveform', 'Hide Waveform'),
      icon: 'i-heroicons-eye',
      onClick: toggleShowWaveform,
    });
  }

  if (clipTrackKind.value === 'video') {
    list.push({
      id: 'toggleShowThumbnails',
      label:
        clip.value.showThumbnails === false
          ? t('fastcat.clip.showThumbnails', 'Show Thumbnails')
          : t('fastcat.clip.hideThumbnails', 'Hide Thumbnails'),
      icon: 'i-heroicons-photo',
      onClick: toggleShowThumbnails,
    });
  }

  if (isMediaVideoClip.value && !hasFreezeFrame.value) {
    list.push({
      id: 'freezeFrame',
      label: t('fastcat.timeline.freezeFrame', 'Freeze Frame'),
      icon: 'i-heroicons-pause-circle',
      onClick: handleFreezeFrame,
    });
  }

  if (isMediaVideoClip.value && hasFreezeFrame.value) {
    list.push({
      id: 'resetFreezeFrame',
      label: t('fastcat.timeline.resetFreezeFrame', 'Reset Freeze Frame'),
      icon: 'i-heroicons-play-circle',
      onClick: handleResetFreezeFrame,
    });
  }

  if (canExtractAudio.value) {
    list.push({
      id: 'extractAudio',
      label: t('fastcat.timeline.extractAudio', 'Extract Audio'),
      icon: 'i-heroicons-musical-note',
      onClick: handleExtractAudio,
    });
  }

  if (hasReturnFromVideoClip.value || hasReturnFromLockedAudioClip.value) {
    list.push({
      id: 'returnAudio',
      label: t('fastcat.timeline.returnAudio', 'Return Audio'),
      icon: 'i-heroicons-arrow-uturn-left',
      onClick: handleReturnAudio,
    });
  }

  return list;
});
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    force-landscape-direction="bottom"
  >
    <div v-if="clip" class="px-4 pb-8">
      <div class="mb-4 pt-1">
        <MobileDrawerToolbar class="-mx-4 mb-2">
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
            primary
            icon="i-heroicons-arrows-right-left"
            :label="t('fastcat.timeline.trimMode', 'Trim')"
            :disabled="isLocked"
            @click="$emit('open-trim-drawer')"
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
              :icon="isSoloed ? 'i-heroicons-musical-note-solid' : 'i-heroicons-musical-note'"
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
            icon="i-heroicons-backspace"
            :label="t('fastcat.timeline.rippleDelete', 'Ripple delete')"
            :disabled="isLocked"
            @click="requestRippleDelete"
          />
        </MobileDrawerToolbar>

        <div v-if="otherActions.length > 0" class="py-1 px-3 border border-ui-border rounded-xl bg-zinc-900/40">
          <PropertyActionList
            :actions="otherActions"
            vertical
            variant="ghost"
            size="md"
          />
        </div>
      </div>

      <ClipProperties :clip="clip" hide-actions />
    </div>

    <UiRenameModal
      :open="isRenameModalOpen"
      :current-name="clip?.name ?? ''"
      :title="t('fastcat.clip.rename', 'Rename clip')"
      @update:open="isRenameModalOpen = $event"
      @rename="handleRename"
    />
  </MobileTimelineDrawer>
</template>
