<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import { useFocusStore, type PanelFocusId } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProxyStore } from '~/stores/proxy.store';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import { isEditableTarget } from '~/utils/hotkeys/hotkeyUtils';
import { useFileManager } from '~/composables/file-manager/useFileManager';

import ClipProperties from '~/components/properties/ClipProperties.vue';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import GapProperties from '~/components/properties/GapProperties.vue';
import TransitionProperties from '~/components/properties/TransitionProperties.vue';
import FileProperties from '~/components/properties/FileProperties.vue';

import MultiFileProperties from '~/components/properties/MultiFileProperties.vue';
import MultiClipProperties from '~/components/properties/MultiClipProperties.vue';
import MarkerProperties from '~/components/properties/MarkerProperties.vue';
import SelectionRangeProperties from '~/components/properties/SelectionRangeProperties.vue';
import TimelineProperties from '~/components/properties/TimelineProperties.vue';
import ProjectEffectProperties from '~/components/properties/ProjectEffectProperties.vue';
import ProjectTransitionProperties from '~/components/properties/ProjectTransitionProperties.vue';
import ProjectLibraryProperties from '~/components/properties/ProjectLibraryProperties.vue';
import type { SelectedEntity } from '~/stores/selection.store';
import { useFileConversionStore } from '~/stores/file-conversion.store';

const props = defineProps<{
  entity?: SelectedEntity | null;
  useExternalFocus?: boolean;
  focusId?: string;
}>();

const emit = defineEmits<{
  panelDragStart: [e: DragEvent];
  clearSelection: [];
}>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const focusStore = useFocusStore();
const selectionStore = useSelectionStore();
const proxyStore = useProxyStore();
const fileManager = useFileManager();
const conversionStore = useFileConversionStore();

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

const selectedTransitionClip = computed(() => {
  if (!selectedTransition.value) return undefined;
  const track = timelineStore.timelineDoc?.tracks.find(
    (t) => t.id === selectedTransition.value!.trackId,
  );
  const item = track?.items.find((i) => i.id === selectedTransition.value!.itemId);
  return item?.kind === 'clip' ? (item as TimelineClipItem) : undefined;
});

const selectedTransitionTrack = computed(() => {
  if (!selectedTransition.value) return undefined;
  return timelineStore.timelineDoc?.tracks.find((t) => t.id === selectedTransition.value!.trackId);
});

const selectedTrack = computed<TimelineTrack | null>(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'track') return null;
  const tracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  return tracks.find((t) => t.id === entity.trackId) ?? null;
});

const selectedGap = computed<{ trackId: string; itemId: string } | null>(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source !== 'timeline' || entity.kind !== 'gap') return null;
  return { trackId: entity.trackId, itemId: entity.itemId };
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

const selectedProjectLibraryItem = computed(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source === 'project' && entity.kind === 'library-item') return entity;
  return null;
});

const selectedMarkerId = computed<string | null>(() => {
  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source === 'timeline' && entity.kind === 'marker') return entity.markerId;
  return null;
});
const isSelectedMarkerZone = computed(() => {
  if (!selectedMarkerId.value) return false;
  const marker = timelineStore.getMarkers().find((m) => m.id === selectedMarkerId.value);
  return marker ? typeof marker.durationUs === 'number' && marker.durationUs > 0 : false;
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
  | 'gap'
  | 'track'
  | 'file'
  | 'files'
  | 'marker'
  | 'selection-range'
  | 'timeline'
  | 'project-effect'
  | 'project-transition'
  | 'project-library-item'
  | 'empty'
>(() => {
  if (selectedTransition.value && selectedTransitionClip.value) return 'transition';
  if (selectedClips.value) return 'clips';
  if (selectedClip.value) return 'clip';
  if (selectedGap.value) return 'gap';
  if (selectedTrack.value) return 'track';
  if (hasSelectionRange.value) return 'selection-range';

  const entity = props.entity !== undefined ? props.entity : selectionStore.selectedEntity;
  if (entity?.source === 'project' && entity.kind === 'effect') return 'project-effect';
  if (entity?.source === 'project' && entity.kind === 'transition') return 'project-transition';
  if (entity?.source === 'project' && entity.kind === 'library-item') return 'project-library-item';
  if (entity?.source === 'timeline' && entity.kind === 'marker') return 'marker';
  // .otio file → same timeline mode as top bar
  if (
    entity?.source === 'fileManager' &&
    entity.kind === 'file' &&
    entity.name?.toLowerCase().endsWith('.otio')
  )
    return 'timeline';
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

  if (entity?.source === 'timeline' && entity.kind === 'timeline-properties') {
    const currentTimelinePath = projectStore.currentTimelinePath;
    if (currentTimelinePath) {
      const entry = fileManager.findEntryByPath(currentTimelinePath);
      if (entry && entry.kind === 'file') {
        return entry;
      }
      return {
        name: currentTimelinePath.split('/').pop() || 'Timeline.otio',
        path: currentTimelinePath,
        kind: 'file' as const,
        source: 'local' as const,
      };
    }
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

const previewOptions = computed(() => [
  { value: 'original', label: t('videoEditor.fileManager.preview.original', 'Original') },
  { value: 'proxy', label: t('videoEditor.fileManager.preview.proxy', 'Proxy') },
]);

const hasProxy = computed(() => {
  if (displayMode.value !== 'file' || !selectedFsEntry.value || !selectedFsEntry.value.path)
    return false;
  return proxyStore.existingProxies.has(selectedFsEntry.value.path);
});

const clipRef = ref<InstanceType<typeof ClipProperties> | null>(null);
const contentRef = ref<HTMLElement | null>(null);

function focusPrimaryElement() {
  nextTick(() => {
    setTimeout(() => {
      if (!contentRef.value) return;
      const target = contentRef.value.querySelector<HTMLElement>(
        '[data-primary-focus="true"], [autofocus]',
      );
      if (target) {
        target.focus();
      }
    }, 100); // Small delay for rendering completion
  });
}

watch(displayMode, (val) => {
  if (val !== 'empty') {
    focusPrimaryElement();
  }
});

function onPanelFocusIn(e: FocusEvent) {
  if (!isEditableTarget(e.target)) return;
  focusStore.setTempFocus('right');
}

function onPanelFocusOut() {
  // Keep focus state
}
const headerTitle = computed(() => {
  if (displayMode.value === 'empty') return t('common.properties', 'Properties');
  if (displayMode.value === 'clip') return selectedClip.value?.name;
  if (displayMode.value === 'transition') return selectedTransitionClip.value?.name ?? '';
  if (displayMode.value === 'file' && selectedFsEntry.value) return selectedFsEntry.value.name;
  if (displayMode.value === 'gap') return t('fastcat.timeline.gap', 'Gap');
  if (displayMode.value === 'track' && selectedTrack.value) return selectedTrack.value.name;
  if (displayMode.value === 'timeline') {
    return selectedFsEntry.value?.name ?? t('fastcat.timeline.properties.title', 'Timeline Properties');
  }
  if (displayMode.value === 'project-effect') return t('fastcat.effects.title', 'Effect');
  if (displayMode.value === 'project-transition') return t('fastcat.transitions.title', 'Transition');
  if (displayMode.value === 'project-library-item') {
    const kind = selectedProjectLibraryItem.value?.itemKind;
    return kind === 'text'
      ? t('fastcat.library.tabs.texts', 'Text')
      : kind === 'shape'
        ? t('fastcat.library.tabs.shapes', 'Shape')
        : t('fastcat.library.tabs.hud', 'HUD');
  }
  if (displayMode.value === 'marker') {
    return isSelectedMarkerZone.value
      ? t('fastcat.marker.zoneMarker', 'Zone Marker')
      : t('fastcat.marker.title', 'Marker');
  }
  if (displayMode.value === 'selection-range') return t('fastcat.timeline.selectionRange', 'Selection Range');
  return t('common.properties', 'Properties');
});
</script>

<template>
  <div
    class="panel-focus-frame flex flex-col h-full bg-ui-bg-elevated border-r border-ui-border min-w-0 relative"
    :class="{
      'panel-focus-frame--active': !props.useExternalFocus && focusStore.isPanelFocused((props.focusId as PanelFocusId) || 'right'),
    }"
    @pointerdown.capture="!props.useExternalFocus && focusStore.setPanelFocus((props.focusId as PanelFocusId) || 'right')"
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
        <span class="ml-2 text-xs text-ui-text-muted font-mono truncate">
          {{ headerTitle }}
        </span>
      </div>
      <div v-if="displayMode !== 'empty'" class="flex gap-1 shrink-0 ml-2">
        <UiButtonGroup
          v-if="displayMode === 'file' && hasProxy"
          v-model="previewMode"
          :options="previewOptions"
        />
        <button
          type="button"
          class="inline-flex items-center justify-center h-7 w-7 rounded-md text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-elevated/50 transition-colors"
          :title="t('common.clearSelection', 'Clear')"
          @click="clearAllSelection"
        >
          <UIcon name="i-heroicons-x-mark" class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Content Area -->
    <div
      ref="contentRef"
      class="flex-1 min-h-0 bg-ui-bg overflow-auto flex flex-col p-2 items-start w-full"
    >
        <div
          v-if="displayMode === 'empty'"
          key="empty"
          class="w-full flex items-center justify-center text-ui-text-muted min-h-50"
        >
          <p class="text-xs">
            {{ t('fastcat.preview.noSelection', 'No item selected') }}
          </p>
        </div>

        <TransitionProperties
          v-else-if="displayMode === 'transition' && selectedTransition && selectedTransitionClip"
          :transition-selection="selectedTransition"
          :clip="selectedTransitionClip"
          :track="selectedTransitionTrack"
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

        <GapProperties
          v-else-if="displayMode === 'gap' && selectedGap"
          :track-id="selectedGap.trackId"
          :item-id="selectedGap.itemId"
        />

        <TrackProperties
          v-else-if="displayMode === 'track' && selectedTrack"
          :track="selectedTrack"
        />

        <FileProperties
          v-else-if="displayMode === 'file' && selectedFsEntry"
          :key="selectedFsEntry.path || selectedFsEntry.name"
          :selected-fs-entry="selectedFsEntry"
          :has-proxy="hasProxy"
          :preview-mode="previewMode"
          @update:preview-mode="(m) => (previewMode = m)"
          @convert="(entry) => conversionStore.openConversionModal(entry)"
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
        <TimelineProperties v-else-if="displayMode === 'timeline'" :fs-entry="selectedFsEntry" />
        <ProjectEffectProperties
          v-else-if="displayMode === 'project-effect' && selectedProjectEffectType"
          :effect-type="selectedProjectEffectType"
        />
        <ProjectTransitionProperties
          v-else-if="displayMode === 'project-transition' && selectedProjectTransitionType"
          :transition-type="selectedProjectTransitionType"
        />
        <ProjectLibraryProperties
          v-else-if="displayMode === 'project-library-item' && selectedProjectLibraryItem"
          :item-kind="selectedProjectLibraryItem.itemKind"
          :item-id="selectedProjectLibraryItem.itemId"
          :preset-params="selectedProjectLibraryItem.presetParams"
        />
        <div
          v-else
          class="flex flex-col items-center justify-center h-full text-ui-text-muted"
        ></div>
    </div>
  </div>
</template>
