<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProxyStore } from '~/stores/proxy.store';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import { isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';

import ClipProperties from '~/components/properties/ClipProperties.vue';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import TransitionProperties from '~/components/properties/TransitionProperties.vue';
import FileProperties from '~/components/properties/FileProperties.vue';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const focusStore = useFocusStore();
const selectionStore = useSelectionStore();
const proxyStore = useProxyStore();

function clearAllSelection() {
  selectionStore.clearSelection();
  timelineStore.clearSelection();
  timelineStore.selectTrack(null);
}

const selectedClip = computed<TimelineClipItem | null>(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'clip') return null;
  const track = timelineStore.timelineDoc?.tracks.find((t) => t.id === entity.trackId);
  const item = track?.items.find((it) => it.id === entity.itemId);
  return item && item.kind === 'clip' ? (item as TimelineClipItem) : null;
});

const selectedTransition = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'transition') return null;
  return { trackId: entity.trackId, itemId: entity.itemId, edge: entity.edge };
});

const selectedTransitionClip = computed<TimelineClipItem | null>(() => {
  const sel = selectedTransition.value;
  if (!sel) return null;
  const track = timelineStore.timelineDoc?.tracks.find((t) => t.id === sel.trackId);
  const item = track?.items.find((it) => it.id === sel.itemId);
  return item && item.kind === 'clip' ? (item as TimelineClipItem) : null;
});

const selectedTrack = computed<TimelineTrack | null>(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'track') return null;
  const tracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  return tracks.find((t) => t.id === entity.trackId) ?? null;
});

const displayMode = computed<'transition' | 'clip' | 'track' | 'file' | 'empty'>(() => {
  if (selectedTransition.value && selectedTransitionClip.value) return 'transition';
  if (selectedClip.value) return 'clip';
  if (selectedTrack.value) return 'track';

  const entity = selectionStore.selectedEntity;
  if (entity?.source === 'fileManager' && (entity.kind === 'file' || entity.kind === 'directory'))
    return 'file';

  return 'empty';
});

const selectedFsEntry = computed(() => {
  const entity = selectionStore.selectedEntity;
  if (entity?.source === 'fileManager' && (entity.kind === 'file' || entity.kind === 'directory')) {
    return entity.entry;
  }
  return null;
});

const previewMode = ref<'original' | 'proxy'>('original');

const hasProxy = computed(() => {
  if (displayMode.value !== 'file' || !selectedFsEntry.value || !selectedFsEntry.value.path)
    return false;
  return proxyStore.existingProxies.has(selectedFsEntry.value.path);
});

const clipRef = ref<InstanceType<typeof ClipProperties> | null>(null);

function onPanelFocusIn(e: FocusEvent) {
  if (!isEditableTarget(e.target)) return;
  focusStore.setTempFocus('right');
}

function onPanelFocusOut() {
  // Keep focus state
}

function openRenameModal() {
  if (clipRef.value) {
    clipRef.value.isRenameModalOpen = true;
  }
}

function handleDeleteClip() {
  if (selectedClip.value) {
    timelineStore.deleteSelectedItems(selectedClip.value.trackId);
  }
}
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0 relative"
    :class="{
      'outline-2 outline-primary-500/60 -outline-offset-2 z-10': focusStore.isPanelFocused('right'),
    }"
    @pointerdown.capture="focusStore.setTempFocus('right')"
    @focusin.capture="onPanelFocusIn"
    @focusout.capture="onPanelFocusOut"
  >
    <!-- Header -->
    <div
      v-if="displayMode !== 'empty'"
      class="flex items-center justify-between px-2 py-1.5 border-b border-ui-border shrink-0"
    >
      <div class="flex items-center overflow-hidden min-w-0">
        <span
          v-if="displayMode === 'clip'"
          class="ml-2 text-xs text-ui-text-muted font-mono truncate"
        >
          {{ selectedClip?.name }}
        </span>
        <span
          v-else-if="displayMode === 'transition'"
          class="ml-2 text-xs text-ui-text-muted font-mono truncate"
        >
          {{ selectedTransitionClip?.name }}
        </span>
        <span
          v-else-if="displayMode === 'file' && selectedFsEntry"
          class="ml-2 text-xs text-ui-text-muted font-mono truncate"
        >
          {{ selectedFsEntry.name }}
        </span>
        <span
          v-else-if="displayMode === 'track' && selectedTrack"
          class="ml-2 text-xs text-ui-text-muted font-mono truncate"
        >
          {{ selectedTrack.name }}
        </span>
      </div>
      <div class="flex gap-1 shrink-0 ml-2">
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-x-mark"
          @click="clearAllSelection"
        />
        <div v-if="displayMode === 'clip'" class="flex gap-1">
          <UButton
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-pencil"
            @click="openRenameModal"
          />
          <UButton
            size="xs"
            variant="ghost"
            color="red"
            icon="i-heroicons-trash"
            @click="handleDeleteClip"
          />
        </div>
        <div v-else-if="displayMode === 'file' && hasProxy" class="flex gap-1">
          <UFieldGroup size="xs">
            <UButton
              :color="previewMode === 'original' ? 'primary' : 'neutral'"
              :variant="previewMode === 'original' ? 'soft' : 'ghost'"
              :label="t('videoEditor.fileManager.preview.original', 'Original')"
              @click="previewMode = 'original'"
            />
            <UButton
              :color="previewMode === 'proxy' ? 'primary' : 'neutral'"
              :variant="previewMode === 'proxy' ? 'soft' : 'ghost'"
              :label="t('videoEditor.fileManager.preview.proxy', 'Proxy')"
              @click="previewMode = 'proxy'"
            />
          </UFieldGroup>
        </div>
      </div>
    </div>

    <!-- Content Area -->
    <div class="flex-1 min-h-0 bg-ui-bg relative">
      <div class="absolute inset-0 overflow-auto">
        <div class="flex flex-col p-2 items-start w-full">
          <div
            v-if="displayMode === 'empty'"
            key="empty"
            class="w-full flex items-center justify-center text-ui-text-muted min-h-50"
          >
            <p class="text-xs">
              {{ t('granVideoEditor.preview.noSelection', 'No item selected') }}
            </p>
          </div>

          <TransitionProperties
            v-else-if="displayMode === 'transition' && selectedTransition && selectedTransitionClip"
            :transition-selection="selectedTransition"
            :clip="selectedTransitionClip"
          />

          <ClipProperties
            v-else-if="displayMode === 'clip' && selectedClip"
            ref="clipRef"
            :clip="selectedClip"
          />

          <TrackProperties
            v-else-if="displayMode === 'track' && selectedTrack"
            :track="selectedTrack"
          />

          <FileProperties
            v-else-if="displayMode === 'file' && selectedFsEntry"
            v-model:preview-mode="previewMode"
            :selected-fs-entry="selectedFsEntry"
            :has-proxy="hasProxy"
          />
        </div>
      </div>
    </div>
  </div>
</template>
