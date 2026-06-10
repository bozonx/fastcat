<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import ClipProperties from '~/components/properties/ClipProperties.vue';
import MobilePropertiesDrawer from './MobilePropertiesDrawer.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import PropertyActionList from '~/components/properties/PropertyActionList.vue';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { useUiStore } from '~/stores/ui.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useProjectStore } from '~/stores/project.store';
import { useClipParametersClipboard } from '~/composables/editor/useClipParametersClipboard';
import ClipParametersPasteModal from '~/components/properties/clip/ClipParametersPasteModal.vue';

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
  handleDeleteClip,
  handleToggleDisabled,
  handleToggleLocked,
  handleToggleMuted,
  otherActionsList: rawOtherActionsList,
} = useClipPropertiesActions({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clip: clip as any,
  trackKind: clipTrackKind,
  timelineStore,
  projectStore,
  uiStore,
  fileManagerStore,
  selectionStore,
  focusStore,
  fileManager,
  setActiveTab,
});

const {
  isPasteParametersModalOpen,
  selectedParameterGroups,
  clipParameterGroupOptions,
  copyClipParameters,
  openPasteClipParameters,
  applyClipParameters,
} = useClipParametersClipboard({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clip: clip as any,
  trackKind: clipTrackKind,
  updateClipProperties: (trackId, itemId, props) =>
    timelineStore.updateClipProperties(trackId, itemId, props),
  updateClipTransition: (trackId, itemId, patch) =>
    timelineStore.updateClipTransition(trackId, itemId, patch),
});

const otherActionsList = computed(() =>
  rawOtherActionsList.value.map((action: { id?: string; onClick?: () => void }) => {
    if (action.id === 'copy-parameters') {
      return { ...action, onClick: () => copyClipParameters() };
    }
    if (action.id === 'paste-parameters') {
      return { ...action, onClick: () => openPasteClipParameters() };
    }
    return action;
  }),
);

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
  <MobilePropertiesDrawer
    v-model:active-snap-point="activeSnapPoint"
    :is-open="props.isOpen"
    @close="emit('close')"
  >
    <template #toolbar>
      <!-- 1. Удалить -->
      <MobileDrawerToolbarButton
        icon="i-heroicons-trash"
        :disabled="isLocked"
        @click="requestDelete"
      />

      <!-- 2. Длительность -->
      <MobileDrawerToolbarButton
        icon="i-heroicons-arrows-right-left"
        :label="t('fastcat.timeline.trimMode')"
        :disabled="isLocked"
        @click="$emit('open-trim-drawer')"
      />

      <!-- 3. Active/disabled -->
      <MobileDrawerToolbarButton
        :icon="clip?.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
        :active="clip?.disabled"
        @click="handleToggleDisabled"
      />

      <!-- 4. Mute -->
      <template v-if="hasAudio">
        <MobileDrawerToolbarButton
          :icon="clip?.audioMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark'"
          :active="clip?.audioMuted"
          @click="handleToggleMuted"
        />
      </template>

      <!-- 5. Locked -->
      <MobileDrawerToolbarButton
        :icon="clip?.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'"
        :active="clip?.locked"
        @click="handleToggleLocked"
      />

      <!-- 6. Копировать -->
      <MobileDrawerToolbarButton icon="i-heroicons-document-duplicate" @click="handleCopy" />

      <!-- 7. Вырезать -->
      <MobileDrawerToolbarButton
        icon="i-heroicons-scissors"
        :disabled="isLocked"
        @click="handleCut"
      />

      <!-- 8. Переименовать -->
      <MobileDrawerToolbarButton
        icon="i-heroicons-pencil"
        :label="t('common.rename')"
        :disabled="isLocked"
        @click="isRenameModalOpen = true"
      />

      <!-- 9. Удалить со сдвигом -->
      <MobileDrawerToolbarButton
        icon="i-heroicons-backspace"
        :label="t('fastcat.timeline.rippleDelete')"
        :disabled="isLocked"
        @click="requestRippleDelete"
      />
    </template>

    <div v-if="clip" class="px-4 pb-8 pt-4">
      <div class="mb-4">
        <div
          v-if="otherActionsList.length > 0"
          class="py-1 px-3 border border-ui-border rounded-xl bg-ui-bg-elevated/40"
        >
          <PropertyActionList
            :actions="otherActionsList as any"
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
      :title="t('fastcat.clip.rename')"
      @update:open="isRenameModalOpen = $event"
      @rename="handleRename"
    />

    <ClipParametersPasteModal
      v-model:open="isPasteParametersModalOpen"
      v-model:selected-groups="selectedParameterGroups"
      :groups="clipParameterGroupOptions"
      @apply="applyClipParameters"
    />
  </MobilePropertiesDrawer>
</template>
