<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import ClipProperties from '~/components/properties/ClipProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
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
  (e: 'close' | 'open-trim-drawer'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const clipboardStore = useAppClipboard();
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

const {
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
  handleReplaceMedia,
  handleDeleteClip,
  handleToggleDisabled,
  handleToggleLocked,
  handleToggleMuted,
  toggleSolo,
  isSoloed,
  otherActionsList,
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
  handleDeleteClip();
  emit('close');
}

function requestRippleDelete() {
  if (!clip.value || isLocked.value) return;
  timelineStore.rippleDeleteFirstSelectedItem();
  emit('close');
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
    with-toolbar-snap
  >
    <template #toolbar>
      <MobileDrawerToolbar class="border-b border-ui-border">
        <MobileDrawerToolbarButton
          icon="i-heroicons-trash"
          :label="t('common.delete')"
          :disabled="isLocked"
          @click="requestDelete"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-pencil"
          :label="t('common.rename')"
          :disabled="isLocked"
          @click="isRenameModalOpen = true"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-document-duplicate"
          :label="t('common.copy')"
          @click="handleCopy"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-scissors"
          :label="t('common.cut')"
          :disabled="isLocked"
          @click="handleCut"
        />

        <MobileDrawerToolbarButton
          primary
          icon="i-heroicons-arrows-right-left"
          :label="t('fastcat.timeline.trimMode')"
          :disabled="isLocked"
          @click="$emit('open-trim-drawer')"
        />

        <MobileDrawerToolbarButton
          :icon="clip?.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
          :label="
            clip?.disabled ? t('fastcat.timeline.enableClip') : t('fastcat.timeline.disableClip')
          "
          :active="clip?.disabled"
          @click="handleToggleDisabled"
        />

        <template v-if="hasAudio">
          <MobileDrawerToolbarButton
            :icon="clip?.audioMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark'"
            :label="
              clip?.audioMuted ? t('fastcat.timeline.unmuteClip') : t('fastcat.timeline.muteClip')
            "
            :active="clip?.audioMuted"
            @click="handleToggleMuted"
          />

          <MobileDrawerToolbarButton
            :icon="isSoloed ? 'i-heroicons-musical-note-solid' : 'i-heroicons-musical-note'"
            :label="isSoloed ? t('fastcat.timeline.unsolo') : t('fastcat.timeline.solo')"
            :active="isSoloed"
            @click="toggleSolo"
          />
        </template>

        <MobileDrawerToolbarButton
          :icon="clip?.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'"
          :label="clip?.locked ? t('fastcat.timeline.unlockClip') : t('fastcat.timeline.lockClip')"
          :active="clip?.locked"
          @click="handleToggleLocked"
        />

        <MobileDrawerToolbarButton
          icon="i-heroicons-backspace"
          :label="t('fastcat.timeline.rippleDelete')"
          :disabled="isLocked"
          @click="requestRippleDelete"
        />
      </MobileDrawerToolbar>
    </template>

    <div v-if="clip" class="px-4 pb-8 pt-4">
      <div class="mb-4">
        <div
          v-if="otherActionsList.length > 0"
          class="py-1 px-3 border border-ui-border rounded-xl bg-zinc-900/40"
        >
          <PropertyActionList :actions="otherActionsList" vertical variant="ghost" size="md" />
        </div>
      </div>

      <ClipProperties :clip="clip" hide-actions />
    </div>

    <UiRenameModal
      :open="isRenameModalOpen"
      :current-name="clip?.name ?? ''"
      :title="t('fastcat.clip.rename')"
      @update:open="isRenameModalOpen = $event"
      @rename="handleRename"
    />
  </MobileTimelineDrawer>
</template>
