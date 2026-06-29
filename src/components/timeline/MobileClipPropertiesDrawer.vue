<script setup lang="ts">
import { computed, type Ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useAppClipboard } from '~/composables/useAppClipboard';
import type { TimelineClipItem } from '~/timeline/types';
import ClipProperties from '~/components/properties/ClipProperties.vue';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';
import MobileDrawerToolbar from './MobileDrawerToolbar.vue';
import MobileDrawerToolbarButton from './MobileDrawerToolbarButton.vue';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { useSelectedTimelineClip } from '~/composables/timeline/useSelectedTimelineClip';
import { useDrawerToolbarOrientation } from '~/composables/timeline/useDrawerToolbarOrientation';
import { useMobileDrawerOpen } from '~/composables/ui/useMobileDrawerOpen';
import { useUiStore } from '~/stores/ui.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useFocusStore } from '~/stores/focus.store';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useProjectStore } from '~/stores/project.store';

const { t } = useI18n();

const props = defineProps<{
  isOpen: boolean;
}>();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'close' | 'open-delete-drawer' | 'open-trim-drawer' | 'open-transitions-drawer'): void;
}>();

/** Landscape renders the drawer as a side panel, so the toolbar is a vertical rail. */
const { toolbarOrientation } = useDrawerToolbarOrientation();

/** Toolbar host: a top row in portrait, a full-height rail in landscape. */
const toolbarWrapperClass = computed(() =>
  toolbarOrientation.value === 'vertical'
    ? 'relative border-r border-ui-border bg-ui-bg-elevated flex flex-col h-full w-full shrink-0'
    : 'relative border-b border-ui-border bg-ui-bg-elevated flex flex-col w-full shrink-0',
);

const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const clipboardStore = useAppClipboard();
const uiStore = useUiStore();
const fileManagerStore = useFileManagerStore();
const focusStore = useFocusStore();
const fileManager = useFileManager();
const { setActiveTab } = useProjectTabsStore();
const projectStore = useProjectStore();

const isOpenLocal = useMobileDrawerOpen(props, emit);

const { clip, track: clipTrack, trackKind: clipTrackKind, isLocked } = useSelectedTimelineClip();

const { handleToggleDisabled, handleToggleLocked, handleToggleMuted } = useClipPropertiesActions({
  // These actions are only invoked from toolbar buttons that are visible while a
  // clip is selected, so `clip` is non-null at call time. Assert the shape (not
  // `any`) so the clip's structure stays type-checked.
  clip: clip as Ref<TimelineClipItem>,
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

const toast = useToast();

function showPasteToast(operation: 'copy' | 'cut') {
  toast.add({
    title: operation === 'cut' ? t('common.cutToClipboard') : t('common.copiedToClipboard'),
    color: 'success',
    icon: 'i-heroicons-clipboard-document-check',
    actions: [
      {
        label: t('common.paste'),
        onClick: () => {
          const payload = clipboardStore.clipboardPayload;
          if (!payload || payload.source !== 'timeline' || payload.items.length === 0) return;
          const playheadUs = timelineStore.currentTime;
          void timelineStore.pasteClips(payload.items, { insertStartUs: playheadUs });
          if (payload.operation === 'cut') {
            clipboardStore.setClipboardPayload(null);
          }
        },
      },
    ],
  });
}

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
  showPasteToast('copy');
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
  showPasteToast('cut');
  emit('close');
}

function handleSplit() {
  if (!clip.value || isLocked.value) return;
  void timelineStore.splitClipAtPlayhead();
}

function handleOpenTrimPanel() {
  emit('open-trim-drawer');
}

function handleOpenTransitionsPanel() {
  emit('open-transitions-drawer');
}

function handleOpenDeleteDrawer() {
  if (isLocked.value) return;
  emit('open-delete-drawer');
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
      <div :class="toolbarWrapperClass">
        <MobileDrawerToolbar
          :orientation="toolbarOrientation"
          content-class="gap-1.5 px-2 pt-0 pb-1.5"
          show-close
          @close="emit('close')"
        >
          <MobileDrawerToolbarButton
            icon="i-heroicons-trash"
            :label="t('common.delete')"
            :disabled="isLocked"
            @click="handleOpenDeleteDrawer"
          />

          <!-- 2. Copy -->
          <MobileDrawerToolbarButton
            icon="i-heroicons-document-duplicate"
            :label="t('common.copy')"
            @click="handleCopy"
          />

          <!-- 3. Cut -->
          <MobileDrawerToolbarButton
            icon="i-heroicons-scissors"
            :label="t('common.cut')"
            :disabled="isLocked"
            @click="handleCut"
          />

          <!-- 4. Open Trim Panel -->
          <MobileDrawerToolbarButton
            icon="i-heroicons-arrows-right-left"
            :label="t('fastcat.timeline.trim')"
            :disabled="isLocked"
            @click="handleOpenTrimPanel"
          />

          <!-- 5. Split -->
          <MobileDrawerToolbarButton
            icon="i-lucide-lab-razor-blade"
            :label="t('fastcat.timeline.split')"
            :disabled="isLocked"
            @click="handleSplit"
          />

          <!-- 5b. Transitions (video tracks only) -->
          <MobileDrawerToolbarButton
            v-if="clipTrackKind === 'video'"
            icon="i-lucide-blend"
            :label="t('fastcat.timeline.transitions')"
            :disabled="isLocked"
            @click="handleOpenTransitionsPanel"
          />

          <!-- 6. Active/disabled -->
          <MobileDrawerToolbarButton
            :icon="clip?.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
            :label="
              clip?.disabled ? t('fastcat.timeline.enableClip') : t('fastcat.timeline.disableClip')
            "
            :active="clip?.disabled"
            @click="handleToggleDisabled"
          />

          <!-- 7. Mute -->
          <template v-if="hasAudio">
            <MobileDrawerToolbarButton
              :icon="clip?.audioMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark'"
              :label="
                clip?.audioMuted ? t('fastcat.timeline.unmuteClip') : t('fastcat.timeline.muteClip')
              "
              :active="clip?.audioMuted"
              @click="handleToggleMuted"
            />
          </template>

          <!-- 8. Locked -->
          <MobileDrawerToolbarButton
            :icon="clip?.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'"
            :label="
              clip?.locked ? t('fastcat.timeline.unlockClip') : t('fastcat.timeline.lockClip')
            "
            :active="clip?.locked"
            @click="handleToggleLocked"
          />
        </MobileDrawerToolbar>
      </div>
    </template>

    <div v-if="clip" class="px-4 pb-8 pt-4">
      <ClipProperties :clip="clip" is-mobile />
    </div>
  </MobileTimelineDrawer>
</template>
