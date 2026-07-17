<script setup lang="ts">
import type { Ref } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import { useClipPropertiesActions } from '~/composables/properties/useClipPropertiesActions';
import { useSelectedTimelineClip } from '~/composables/timeline/useSelectedTimelineClip';
import { useCloseModel } from '~/composables/ui/useCloseModel';
import { useFileManager } from '~/composables/file-manager/useFileManager';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useFocusStore } from '~/stores/focus.store';
import { useProjectStore } from '~/stores/project.store';
import { useProjectTabsStore } from '~/stores/project-tabs.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useUiStore } from '~/stores/ui.store';
import MobileTimelineDrawer from './MobileTimelineDrawer.vue';

const props = defineProps<{
  isOpen: boolean;
}>();

const activeSnapPoint = defineModel<string | number | null>('activeSnapPoint', { default: null });

const emit = defineEmits<{
  (e: 'back' | 'close'): void;
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const uiStore = useUiStore();
const fileManagerStore = useFileManagerStore();
const focusStore = useFocusStore();
const projectStore = useProjectStore();
const fileManager = useFileManager();
const { setActiveTab } = useProjectTabsStore();

const isOpenLocal = useCloseModel(
  () => props.isOpen,
  () => emit('close'),
);

const { clip, trackKind: clipTrackKind, isLocked } = useSelectedTimelineClip();

const { handleDeleteClip } = useClipPropertiesActions({
  // `requestDelete` guards on `clip.value` before invoking the action, so it is
  // non-null at call time. Assert the shape (not `any`) to keep it type-checked.
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

function requestExtractTimeline() {
  if (!clip.value || isLocked.value) return;
  timelineStore.rippleDeleteSelectedClipRangeAllTracks();
  emit('close');
}
</script>

<template>
  <MobileTimelineDrawer
    v-model:open="isOpenLocal"
    v-model:active-snap-point="activeSnapPoint"
    initial-mode="full"
  >
    <template #header>
      <div class="flex items-center justify-between px-3">
        <UButton
          icon="i-heroicons-chevron-left"
          variant="ghost"
          color="gray"
          size="sm"
          @click="emit('back')"
        />
        <span class="text-xs font-bold text-ui-text uppercase tracking-wider">
          {{ t('fastcat.timeline.delete') }}
        </span>
        <UButton
          icon="i-heroicons-x-mark"
          variant="ghost"
          color="gray"
          size="sm"
          @click="emit('close')"
        />
      </div>
    </template>

    <div class="flex flex-col gap-2 px-4 pb-8 pt-3">
      <button
        class="flex items-center gap-3 rounded-xl border border-ui-border/80 bg-ui-bg px-3 py-3 text-left active:bg-red-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
        :disabled="isLocked"
        @click="requestRippleDelete"
      >
        <UIcon name="i-heroicons-backspace" class="w-5 h-5 shrink-0 text-red-400" />
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-ui-text">
            {{ t('fastcat.timeline.rippleDelete') }}
          </span>
          <span class="block text-xs text-ui-text-muted">
            {{ t('fastcat.timeline.rippleDeleteHint') }}
          </span>
        </span>
      </button>

      <button
        class="flex items-center gap-3 rounded-xl border border-ui-border/80 bg-ui-bg px-3 py-3 text-left active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
        :disabled="isLocked"
        @click="requestDelete"
      >
        <UIcon name="i-heroicons-trash" class="w-5 h-5 shrink-0 text-ui-text-muted" />
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-ui-text">
            {{ t('fastcat.timeline.deleteLift') }}
          </span>
          <span class="block text-xs text-ui-text-muted">
            {{ t('fastcat.timeline.deleteLiftHint') }}
          </span>
        </span>
      </button>

      <button
        class="flex items-center gap-3 rounded-xl border border-ui-border/80 bg-ui-bg px-3 py-3 text-left active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
        :disabled="isLocked"
        @click="requestExtractTimeline"
      >
        <UIcon name="i-heroicons-scissors" class="w-5 h-5 shrink-0 text-ui-text-muted" />
        <span class="min-w-0">
          <span class="block text-sm font-semibold text-ui-text">
            {{ t('fastcat.timeline.extractRange') }}
          </span>
          <span class="block text-xs text-ui-text-muted">
            {{ t('fastcat.timeline.extractRangeHint') }}
          </span>
        </span>
      </button>
    </div>
  </MobileTimelineDrawer>
</template>
