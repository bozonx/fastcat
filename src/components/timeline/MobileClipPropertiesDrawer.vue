<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import ClipProperties from '~/components/properties/ClipProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
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

const showDeleteOverlay = ref(false);
const showTrimOverlay = ref(false);

function closeOverlays() {
  showDeleteOverlay.value = false;
  showTrimOverlay.value = false;
}

watch(() => props.isOpen, (newVal) => {
  if (!newVal) {
    closeOverlays();
  }
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
  handleDeleteClip,
  handleToggleDisabled,
  handleToggleLocked,
  handleToggleMuted,
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

function handleSplit() {
  if (!clip.value || isLocked.value) return;
  void timelineStore.splitClipAtPlayhead();
}

function requestDelete() {
  if (!clip.value || isLocked.value) return;
  handleDeleteClip();
  closeOverlays();
  emit('close');
}

function requestRippleDelete() {
  if (!clip.value || isLocked.value) return;
  timelineStore.rippleDeleteFirstSelectedItem();
  closeOverlays();
  emit('close');
}

function requestExtractTimeline() {
  if (!clip.value || isLocked.value) return;
  timelineStore.rippleDeleteSelectedClipRangeAllTracks();
  closeOverlays();
  emit('close');
}

function handleRippleTrimLeft() {
  if (!clip.value || isLocked.value) return;
  void timelineStore.rippleTrimLeft();
  closeOverlays();
}

function handleRippleTrimRight() {
  if (!clip.value || isLocked.value) return;
  void timelineStore.rippleTrimRight();
  closeOverlays();
}

function handleManualTrim() {
  closeOverlays();
  emit('open-trim-drawer');
}

function toggleDeleteOverlay() {
  if (isLocked.value) return;
  showDeleteOverlay.value = !showDeleteOverlay.value;
  showTrimOverlay.value = false;
}

function toggleTrimOverlay() {
  if (isLocked.value) return;
  showTrimOverlay.value = !showTrimOverlay.value;
  showDeleteOverlay.value = false;
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
      <div class="relative border-b border-ui-border bg-ui-bg-elevated flex flex-col w-full">
        <!-- 1. Delete Overlay -->
        <Transition name="slide-up">
          <div
            v-if="showDeleteOverlay"
            class="absolute bottom-full left-0 right-0 bg-ui-bg-elevated border-b border-ui-border px-3 py-2 flex items-center justify-between gap-2 shadow-lg z-50"
          >
            <span class="text-xs font-bold text-ui-text-muted uppercase tracking-wider">
              {{ t('fastcat.timeline.delete') }}
            </span>
            <div class="flex gap-2">
              <UButton
                size="sm"
                color="gray"
                variant="ghost"
                class="cursor-pointer"
                @click="requestDelete"
              >
                {{ t('fastcat.timeline.deleteLift') }}
              </UButton>
              <UButton
                size="sm"
                color="red"
                variant="soft"
                class="cursor-pointer"
                @click="requestRippleDelete"
              >
                {{ t('fastcat.timeline.rippleDelete') }}
              </UButton>
              <UButton
                size="sm"
                color="red"
                variant="solid"
                class="cursor-pointer"
                @click="requestExtractTimeline"
              >
                {{ t('fastcat.timeline.extractRange') }}
              </UButton>
              <div class="w-px h-6 bg-ui-border mx-1" />
              <UButton
                size="sm"
                color="gray"
                variant="ghost"
                icon="i-heroicons-x-mark"
                class="cursor-pointer"
                @click="closeOverlays"
              />
            </div>
          </div>
        </Transition>

        <!-- 2. Trim Overlay -->
        <Transition name="slide-up">
          <div
            v-if="showTrimOverlay"
            class="absolute bottom-full left-0 right-0 bg-ui-bg-elevated border-b border-ui-border px-3 py-2 flex items-center justify-between gap-2 shadow-lg z-50"
          >
            <span class="text-xs font-bold text-ui-text-muted uppercase tracking-wider">
              {{ t('fastcat.timeline.trimOptions') }}
            </span>
            <div class="flex gap-2">
              <UButton
                size="sm"
                color="gray"
                variant="ghost"
                icon="i-heroicons-arrow-left"
                class="cursor-pointer"
                @click="handleRippleTrimLeft"
              >
                {{ t('fastcat.timeline.rippleTrimLeft') }}
              </UButton>
              <UButton
                size="sm"
                color="gray"
                variant="ghost"
                icon="i-heroicons-arrow-right"
                class="cursor-pointer"
                @click="handleRippleTrimRight"
              >
                {{ t('fastcat.timeline.rippleTrimRight') }}
              </UButton>
              <UButton
                size="sm"
                color="primary"
                variant="soft"
                icon="i-heroicons-arrows-right-left"
                class="cursor-pointer"
                @click="handleManualTrim"
              >
                {{ t('fastcat.timeline.manualTrim') }}
              </UButton>
              <div class="w-px h-6 bg-ui-border mx-1" />
              <UButton
                size="sm"
                color="gray"
                variant="ghost"
                icon="i-heroicons-x-mark"
                class="cursor-pointer"
                @click="closeOverlays"
              />
            </div>
          </div>
        </Transition>

        <!-- Main Toolbar Buttons -->
        <MobileDrawerToolbar content-class="gap-1.5 px-2 py-1.5">
          <!-- 1. Toggle Delete Overlay -->
          <MobileDrawerToolbarButton
            icon="i-heroicons-trash"
            :disabled="isLocked"
            :active="showDeleteOverlay"
            @click="toggleDeleteOverlay"
          />

          <!-- 2. Toggle Trim Overlay -->
          <MobileDrawerToolbarButton
            icon="i-heroicons-arrows-right-left"
            :disabled="isLocked"
            :active="showTrimOverlay"
            @click="toggleTrimOverlay"
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

          <!-- 6. Copy -->
          <MobileDrawerToolbarButton icon="i-heroicons-document-duplicate" @click="handleCopy" />

          <!-- 7. Cut -->
          <MobileDrawerToolbarButton
            icon="i-heroicons-scissors"
            :disabled="isLocked"
            @click="handleCut"
          />

          <!-- 8. Split -->
          <MobileDrawerToolbarButton
            icon="i-lucide-scissors"
            :disabled="isLocked"
            :label="t('fastcat.timeline.split')"
            @click="handleSplit"
          />

          <!-- 9. Rename -->
          <MobileDrawerToolbarButton
            icon="i-heroicons-pencil"
            :label="t('common.rename')"
            :disabled="isLocked"
            @click="isRenameModalOpen = true"
          />
        </MobileDrawerToolbar>
      </div>
    </template>

    <div v-if="clip" class="px-4 pb-8 pt-4">
      <ClipProperties :clip="clip" is-mobile />
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

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
