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

async function runTrim(action: () => void | Promise<void>) {
  if (!clip.value || isLocked.value) return;
  await action();
  emit('back');
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

    <div class="flex flex-col gap-3 px-4 pb-8 pt-3">
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

      <div class="bg-ui-bg rounded-xl border border-ui-border/80 overflow-hidden shadow-inner">
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
          <div class="grid grid-cols-2 divide-x divide-ui-border/80">
            <button
              class="py-2.5 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              :disabled="isLocked"
              @click="runTrim(timelineStore.trimToPlayheadLeftNoRipple)"
            >
              {{ t('fastcat.timeline.trim') }}
            </button>
            <button
              class="py-2.5 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              :disabled="isLocked"
              @click="runTrim(timelineStore.trimToPlayheadRightNoRipple)"
            >
              {{ t('fastcat.timeline.trim') }}
            </button>
          </div>

          <div class="grid grid-cols-2 divide-x divide-ui-border/80">
            <button
              class="py-2.5 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              :disabled="isLocked"
              @click="runTrim(timelineStore.rippleTrimLeft)"
            >
              {{ t('fastcat.timeline.trimWithOffset') }}
            </button>
            <button
              class="py-2.5 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              :disabled="isLocked"
              @click="runTrim(timelineStore.rippleTrimRight)"
            >
              {{ t('fastcat.timeline.trimWithOffset') }}
            </button>
          </div>

          <div class="grid grid-cols-2 divide-x divide-ui-border/80">
            <button
              class="py-2.5 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              :disabled="isLocked"
              @click="runTrim(timelineStore.advancedRippleTrimLeft)"
            >
              {{ t('fastcat.timeline.trimWithTimelineCut') }}
            </button>
            <button
              class="py-2.5 text-center text-xs font-semibold text-ui-text active:bg-blue-500/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              :disabled="isLocked"
              @click="runTrim(timelineStore.advancedRippleTrimRight)"
            >
              {{ t('fastcat.timeline.trimWithTimelineCut') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </MobileTimelineDrawer>
</template>
