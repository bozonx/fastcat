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
import RemoteFileProperties from '~/components/properties/RemoteFileProperties.vue';
import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import MultiClipProperties from '~/components/properties/MultiClipProperties.vue';
import MarkerProperties from '~/components/properties/MarkerProperties.vue';
import SelectionRangeProperties from '~/components/properties/SelectionRangeProperties.vue';
import TimelineProperties from '~/components/properties/TimelineProperties.vue';
import ProjectEffectProperties from '~/components/properties/ProjectEffectProperties.vue';
import ProjectTransitionProperties from '~/components/properties/ProjectTransitionProperties.vue';
import type { SelectedEntity } from '~/stores/selection.store';
import { useFileConversion } from '~/composables/fileManager/useFileConversion';

const props = defineProps<{
  entity?: SelectedEntity | null;
}>();

const emit = defineEmits<{
  panelDragStart: [e: DragEvent];
  clearSelection: [];
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const focusStore = useFocusStore();
const selectionStore = useSelectionStore();
const proxyStore = useProxyStore();
const fileConversion = useFileConversion();

function clearAllSelection() {
  selectionStore.clearSelection();
  timelineStore.clearSelection();
  timelineStore.selectTrack(null);
  emit('clearSelection');
}

const selectedClip = computed<TimelineClipItem | null>(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (selectedClips.value) return null;
  if (entity?.source !== 'timeline' || entity.kind !== 'clip') return null;
  const track = timelineStore.timelineDoc?.tracks.find((t) => t.id === entity.trackId);
  const item = track?.items.find((it) => it.id === entity.itemId);
  return item && item.kind === 'clip' ? (item as TimelineClipItem) : null;
});

const selectedTransition = computed(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
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
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'track') return null;
  const tracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  return tracks.find((t) => t.id === entity.trackId) ?? null;
});

const selectedProjectEffectType = computed<string | null>(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source === 'project' && entity.kind === 'effect') return entity.effectType;
  return null;
});

const selectedProjectTransitionType = computed<string | null>(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source === 'project' && entity.kind === 'transition') return entity.transitionType;
  return null;
});

const selectedMarkerId = computed<string | null>(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source === 'timeline' && entity.kind === 'marker') return entity.markerId;
  return null;
});

const hasSelectionRange = computed(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  return entity?.source === 'timeline' && entity.kind === 'selection-range';
});

const selectedClips = computed(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source === 'timeline' && entity.kind === 'clips') {
    return entity.items;
  }

  return null;
});

const displayMode = computed<
  | 'transition'
  | 'clip'
  | 'clips'
  | 'track'
  | 'file'
  | 'files'
  | 'marker'
  | 'selection-range'
  | 'timeline'
  | 'project-effect'
  | 'project-transition'
  | 'empty'
>(() => {
  if (selectedTransition.value && selectedTransitionClip.value) return 'transition';
  if (selectedClips.value) return 'clips';
  if (selectedClip.value) return 'clip';
  if (selectedTrack.value) return 'track';
  if (hasSelectionRange.value) return 'selection-range';

  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source === 'project' && entity.kind === 'effect') return 'project-effect';
  if (entity?.source === 'project' && entity.kind === 'transition') return 'project-transition';
  if (entity?.source === 'timeline' && entity.kind === 'marker') return 'marker';
  if (entity?.source === 'fileManager' && (entity.kind === 'file' || entity.kind === 'directory'))
    return 'file';
  if (entity?.source === 'fileManager' && entity.kind === 'multiple') return 'files';
  if (entity?.source === 'timeline' && entity.kind === 'timeline-properties') return 'timeline';

  return 'empty';
});

const selectedFsEntry = computed(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source === 'fileManager' && (entity.kind === 'file' || entity.kind === 'directory')) {
    return entity.entry;
  }
  return null;
});

const selectedFsEntries = computed(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source === 'fileManager' && entity.kind === 'multiple') {
    return entity.entries;
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
      class="flex items-center justify-between px-2 py-1.5 border-b border-ui-border shrink-0 cursor-grab active:cursor-grabbing"
      draggable="true"
      @dragstart="(e) => $emit('panelDragStart', e)"
    >
      <div class="flex items-center overflow-hidden min-w-0">
        <template v-if="displayMode !== 'empty'">
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
          <span
            v-else-if="displayMode === 'timeline'"
            class="ml-2 text-xs text-ui-text-muted font-mono truncate"
          >
            {{ t('granVideoEditor.timeline.properties.title', 'Timeline Properties') }}
          </span>
          <span
            v-else-if="displayMode === 'project-effect'"
            class="ml-2 text-xs text-ui-text-muted font-mono truncate"
          >
            {{ t('granVideoEditor.effects.title', 'Effect') }}
          </span>
          <span
            v-else-if="displayMode === 'project-transition'"
            class="ml-2 text-xs text-ui-text-muted font-mono truncate"
          >
            {{ t('granVideoEditor.transitions.title', 'Transition') }}
          </span>
        </template>
        <span v-else class="ml-2 text-xs text-ui-text-muted font-mono truncate">
          {{ t('common.properties', 'Properties') }}
        </span>
      </div>
      <div v-if="displayMode !== 'empty'" class="flex gap-1 shrink-0 ml-2">
        <div v-if="displayMode === 'file' && hasProxy" class="flex gap-1">
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
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-x-mark"
          @click="clearAllSelection"
        />
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

          <MultiClipProperties
            v-else-if="displayMode === 'clips' && selectedClips"
            :items="selectedClips"
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
            v-else-if="
              displayMode === 'file' && selectedFsEntry && selectedFsEntry.source !== 'remote'
            "
            :selected-fs-entry="selectedFsEntry"
            :has-proxy="hasProxy"
            :preview-mode="previewMode"
            @update:preview-mode="(m) => (previewMode = m)"
            @convert="(entry) => fileConversion.openConversionModal(entry)"
          />
          <RemoteFileProperties
            v-else-if="
              displayMode === 'file' && selectedFsEntry && selectedFsEntry.source === 'remote'
            "
            :selected-fs-entry="selectedFsEntry"
          />
          <MultiFileProperties
            v-else-if="displayMode === 'files' && selectedFsEntries"
            :entries="selectedFsEntries"
          />
          <MarkerProperties
            v-else-if="displayMode === 'marker' && selectedMarkerId"
            v-model:marker-id="selectedMarkerId"
          />
          <SelectionRangeProperties v-else-if="displayMode === 'selection-range'" />
          <TimelineProperties v-else-if="displayMode === 'timeline'" />
          <div
            v-else
            class="flex flex-col items-center justify-center h-full text-ui-text-muted"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>
