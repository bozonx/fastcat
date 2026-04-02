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
          icon="i-heroicons-trash"
          :label="t('common.delete', 'Delete')"
          danger
          :disabled="isLocked"
          @click="requestDelete"
        />

        <MobileDrawerToolbarButton
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
      </MobileDrawerToolbar>
    </template>

    <template #header>
      <div class="flex items-center gap-2 min-w-0">
        <div class="w-7 h-7 rounded bg-zinc-800 flex items-center justify-center shrink-0">
          <UIcon name="i-heroicons-film" class="w-4 h-4 text-zinc-400" />
        </div>
        <span class="text-sm font-bold text-zinc-200 truncate leading-none">
          {{ clip?.name || t('fastcat.timeline.clipActions', 'Clip') }}
        </span>
      </div>
    </template>

    <div v-if="clip" class="px-4 pt-4 pb-8">
      <ClipProperties :clip="clip" />
    </div>

    <UiConfirmModal
      v-model:open="isDeleteConfirmOpen"
      :title="t('fastcat.timeline.deleteClipTitle', 'Delete clip?')"
      :description="t('fastcat.timeline.deleteClipDescription', 'This action cannot be undone.')"
      color="error"
      icon="i-heroicons-exclamation-triangle"
      :confirm-text="t('common.delete', 'Delete')"
      @confirm="confirmDelete"
    />
  </MobileTimelineDrawer>
</template>
