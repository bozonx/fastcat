<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useWindowSize } from '@vueuse/core';
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

const { width, height } = useWindowSize();
/** Landscape renders the drawer as a side panel, so the toolbar is a vertical rail. */
const toolbarOrientation = computed(() => (width.value > height.value ? 'vertical' : 'horizontal'));

/** Toolbar host: a top row in portrait, a full-height rail in landscape. */
const toolbarWrapperClass = computed(() =>
  toolbarOrientation.value === 'vertical'
    ? 'relative border-r border-ui-border bg-ui-bg-elevated flex flex-col h-full'
    : 'relative border-b border-ui-border bg-ui-bg-elevated flex flex-col w-full',
);

/**
 * The action overlays (delete / trim) pop out from the toolbar edge: upward above
 * the row in portrait, sideways from the rail in landscape.
 */
const overlayClass = computed(() =>
  toolbarOrientation.value === 'vertical'
    ? 'absolute left-full top-2 ml-2 z-50 flex flex-col gap-3 px-3 py-3 w-72 max-w-[60vw] rounded-xl bg-ui-bg-elevated border border-ui-border shadow-lg max-h-[80vh] overflow-y-auto'
    : 'absolute bottom-full left-0 right-0 z-50 flex flex-col gap-3 px-3 py-3 bg-ui-bg-elevated border-b border-ui-border shadow-lg max-h-[60vh] overflow-y-auto',
);

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

function closeDeleteOverlay() {
  showDeleteOverlay.value = false;
}

watch(
  () => props.isOpen,
  (newVal) => {
    if (!newVal) {
      closeDeleteOverlay();
    }
  },
);

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

const { handleDeleteClip, handleToggleDisabled, handleToggleLocked, handleToggleMuted } =
  useClipPropertiesActions({
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
  showDeleteOverlay.value = false;
}

function requestRippleDelete() {
  if (!clip.value || isLocked.value) return;
  timelineStore.rippleDeleteFirstSelectedItem();
  showDeleteOverlay.value = false;
}

function requestExtractTimeline() {
  if (!clip.value || isLocked.value) return;
  timelineStore.rippleDeleteSelectedClipRangeAllTracks();
  showDeleteOverlay.value = false;
}

function handleOpenTrimPanel() {
  emit('open-trim-drawer');
}

function toggleDeleteOverlay() {
  if (isLocked.value) return;
  showDeleteOverlay.value = !showDeleteOverlay.value;
}

async function handleTrimLeft() {
  if (isLocked.value) return;
  await timelineStore.trimToPlayheadLeftNoRipple();
  showDeleteOverlay.value = false;
}

async function handleTrimRight() {
  if (isLocked.value) return;
  await timelineStore.trimToPlayheadRightNoRipple();
  showDeleteOverlay.value = false;
}

async function handleRippleTrimLeft() {
  if (isLocked.value) return;
  await timelineStore.rippleTrimLeft();
  showDeleteOverlay.value = false;
}

async function handleRippleTrimRight() {
  if (isLocked.value) return;
  await timelineStore.rippleTrimRight();
  showDeleteOverlay.value = false;
}

async function handleAdvancedTrimLeft() {
  if (isLocked.value) return;
  await timelineStore.advancedRippleTrimLeft();
  showDeleteOverlay.value = false;
}

async function handleAdvancedTrimRight() {
  if (isLocked.value) return;
  await timelineStore.advancedRippleTrimRight();
  showDeleteOverlay.value = false;
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
        <!-- 1. Delete Overlay -->
        <Transition name="slide-up">
          <div v-if="showDeleteOverlay" :class="overlayClass">
            <!-- Delete section -->
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-ui-text-muted uppercase tracking-wider">
                {{ t('fastcat.timeline.delete') }}
              </span>
              <UButton
                size="xs"
                color="gray"
                variant="ghost"
                icon="i-heroicons-x-mark"
                class="cursor-pointer"
                @click="closeDeleteOverlay"
              />
            </div>
            <div class="grid grid-cols-3 gap-2">
              <UButton
                size="sm"
                color="gray"
                variant="soft"
                class="cursor-pointer justify-center"
                :disabled="isLocked"
                @click="requestDelete"
              >
                {{ t('fastcat.timeline.deleteLift') }}
              </UButton>
              <UButton
                size="sm"
                color="red"
                variant="soft"
                class="cursor-pointer justify-center"
                :disabled="isLocked"
                @click="requestRippleDelete"
              >
                {{ t('fastcat.timeline.rippleDelete') }}
              </UButton>
              <UButton
                size="sm"
                color="red"
                variant="soft"
                class="cursor-pointer justify-center"
                :disabled="isLocked"
                @click="requestExtractTimeline"
              >
                {{ t('fastcat.timeline.extractRange') }}
              </UButton>
            </div>

            <!-- Playhead trim section -->
            <div
              class="bg-ui-bg rounded-xl border border-ui-border/80 overflow-hidden shadow-inner"
            >
              <!-- Column headers -->
              <div class="grid grid-cols-2 divide-x divide-ui-border/80">
                <div class="py-2 text-center">
                  <span class="text-[10px] uppercase font-black text-ui-text-muted tracking-wider">
                    {{ t('fastcat.timeline.leftTail') }}
                  </span>
                </div>
                <div class="py-2 text-center">
                  <span class="text-[10px] uppercase font-black text-ui-text-muted tracking-wider">
                    {{ t('fastcat.timeline.rightTail') }}
                  </span>
                </div>
              </div>

              <div class="border-t border-ui-border/80 divide-y divide-ui-border/80">
                <!-- Row 1: Basic trim -->
                <div class="grid grid-cols-2 divide-x divide-ui-border/80">
                  <button
                    class="py-2.5 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    :disabled="isLocked"
                    @click="handleTrimLeft"
                  >
                    {{ t('fastcat.timeline.trim') }}
                  </button>
                  <button
                    class="py-2.5 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    :disabled="isLocked"
                    @click="handleTrimRight"
                  >
                    {{ t('fastcat.timeline.trim') }}
                  </button>
                </div>

                <!-- Row 2: Ripple trim -->
                <div class="grid grid-cols-2 divide-x divide-ui-border/80">
                  <button
                    class="py-2.5 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    :disabled="isLocked"
                    @click="handleRippleTrimLeft"
                  >
                    {{ t('fastcat.timeline.trimWithOffset') }}
                  </button>
                  <button
                    class="py-2.5 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    :disabled="isLocked"
                    @click="handleRippleTrimRight"
                  >
                    {{ t('fastcat.timeline.trimWithOffset') }}
                  </button>
                </div>

                <!-- Row 3: Advanced ripple trim -->
                <div class="grid grid-cols-2 divide-x divide-ui-border/80">
                  <button
                    class="py-2.5 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    :disabled="isLocked"
                    @click="handleAdvancedTrimLeft"
                  >
                    {{ t('fastcat.timeline.trimWithTimelineCut') }}
                  </button>
                  <button
                    class="py-2.5 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                    :disabled="isLocked"
                    @click="handleAdvancedTrimRight"
                  >
                    {{ t('fastcat.timeline.trimWithTimelineCut') }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Transition>

        <!-- Main Toolbar Buttons -->
        <MobileDrawerToolbar :orientation="toolbarOrientation" content-class="gap-1.5 px-2 py-1.5">
          <!-- 1. Toggle Delete Overlay -->
          <MobileDrawerToolbarButton
            icon="i-heroicons-trash"
            :disabled="isLocked"
            :active="showDeleteOverlay"
            @click="toggleDeleteOverlay"
          />

          <!-- 2. Copy -->
          <MobileDrawerToolbarButton icon="i-heroicons-document-duplicate" @click="handleCopy" />

          <!-- 3. Cut -->
          <MobileDrawerToolbarButton
            icon="i-heroicons-scissors"
            :disabled="isLocked"
            @click="handleCut"
          />

          <!-- 4. Open Trim Panel -->
          <MobileDrawerToolbarButton
            icon="i-heroicons-arrows-right-left"
            :disabled="isLocked"
            @click="handleOpenTrimPanel"
          />

          <!-- 5. Split -->
          <MobileDrawerToolbarButton
            icon="i-lucide-lab-razor-blade"
            :disabled="isLocked"
            @click="handleSplit"
          />

          <!-- 6. Active/disabled -->
          <MobileDrawerToolbarButton
            :icon="clip?.disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
            :active="clip?.disabled"
            @click="handleToggleDisabled"
          />

          <!-- 7. Mute -->
          <template v-if="hasAudio">
            <MobileDrawerToolbarButton
              :icon="clip?.audioMuted ? 'i-heroicons-speaker-wave' : 'i-heroicons-speaker-x-mark'"
              :active="clip?.audioMuted"
              @click="handleToggleMuted"
            />
          </template>

          <!-- 8. Locked -->
          <MobileDrawerToolbarButton
            :icon="clip?.locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed'"
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

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
}

.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
