<script setup lang="ts">
import { ref, computed, toRefs, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import type {
  TimelineClipActionPayload,
  TimelineMoveItemPayload,
  TimelineOpenSpeedModalPayload,
  TimelineTrack,
  TimelineTrackItem,
  TimelineTrimItemPayload,
} from '~/timeline/types';
import { timeUsToPx } from '~/utils/timeline/geometry';
import { useTimelineClipHandleResize } from '~/composables/timeline/useTimelineClipHandleResize';
import { useTimelineMarquee } from '~/composables/timeline/useTimelineMarquee';
import { useFocusStore } from '~/stores/focus.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useMediaStore } from '~/stores/media.store';

import TimelineGap from './TimelineGap.vue';
import AutoMontageModal from './AutoMontageModal.vue';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';
import UiRenameModal from '~/components/ui/UiRenameModal.vue';
import ClipParametersPasteModal from '~/components/properties/clip/ClipParametersPasteModal.vue';

import { useTimelineEmptyAreaContextMenu } from '~/composables/timeline/useTimelineEmptyAreaContextMenu';
import { useProvideTimelineContext } from '~/composables/timeline/useProvideTimelineContext';
import { useTimelineTrackVirtualization } from '~/composables/timeline/useTimelineTrackVirtualization';
import { useTimelineMovePreviews } from '~/composables/timeline/useTimelineMovePreviews';
import { useTimelineAutoMontage } from '~/composables/timeline/useTimelineAutoMontage';
import { useTimelineTrackContextMenu } from '~/composables/timeline/useTimelineTrackContextMenu';
import { useTimelinePasteParameters } from '~/composables/timeline/useTimelinePasteParameters';
import type { TimelineTrimPreview } from '~/composables/timeline/useTimelineItemDrag';

import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const focusStore = useFocusStore();
const uiStore = useUiStore();
const workspaceStore = useWorkspaceStore();
const mediaStore = useMediaStore();

// Provide the shared TimelineContext consumed by descendant clip/gap components.
useProvideTimelineContext();

const { selectedTransition } = storeToRefs(timelineStore);
const { isTrackVisuallySelected } = selectionStore;

const props = defineProps<{
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  canEditClipContent: boolean;
  scrollLeft?: number;
  viewportWidth?: number;
  dragPreview?: {
    trackId: string;
    startUs: number;
    label: string;
    durationUs: number;
    kind: 'timeline-clip' | 'file';
  } | null;
  movePreview?: { itemId: string; trackId: string; startUs: number; isCollision?: boolean }[];
  slipPreview?: { itemId: string; trackId: string; deltaUs: number; timecode: string } | null;
  trimPreview?: TimelineTrimPreview[] | null;
  draggingMode?: 'move' | 'slip' | 'trim_start' | 'trim_end' | null;
  draggingItemId?: string | null;
  isMobile?: boolean;
  isAnyDrawerOpen?: boolean;
  /** Mobile multi-selection mode: tint selected clips as a multi-selection even with one selected. */
  isMultiSelectMode?: boolean;
  onZoomToFit?: () => void;
}>();

const emit = defineEmits<{
  (e: 'drop', event: DragEvent, trackId: string): void;
  (e: 'dragover', event: DragEvent, trackId: string): void;
  (e: 'dragleave', event: DragEvent, trackId: string): void;
  (e: 'startMoveItem', event: PointerEvent, payload: TimelineMoveItemPayload): void;
  (e: 'selectItem', event: PointerEvent, itemId: string): void;
  (e: 'clipAction', payload: TimelineClipActionPayload): void;
  (e: 'startTrimItem', event: PointerEvent, payload: TimelineTrimItemPayload): void;
  (e: 'long-press-item', itemId: string): void;
  (e: 'open-speed-modal', payload: TimelineOpenSpeedModalPayload): void;
}>();

const containerRef = ref<HTMLElement | null>(null);
const { tracks, trackHeights } = toRefs(props);

/** True only when the track header itself is selected (not a clip/gap/transition on it). */
function isTrackDirectlySelected(trackId: string): boolean {
  const entity = selectionStore.selectedEntity;
  return entity?.source === 'timeline' && entity.kind === 'track' && entity.trackId === trackId;
}

// Windowing + render-ready track view models (geometry, visibility, selection).
const { trackViewModels } = useTimelineTrackVirtualization({
  tracks: () => props.tracks,
  mediaMetadata: () => mediaStore.mediaMetadata,
  trackHeights: () => props.trackHeights,
  scrollLeft: () => props.scrollLeft ?? 0,
  viewportWidth: () => props.viewportWidth ?? 0,
  zoom: () => timelineStore.timelineZoom,
  hoveredTrackId: () => timelineStore.hoveredTrackId,
  isTrackDirectlySelected,
  isTrackVisuallySelected: (id) => isTrackVisuallySelected(id),
});

const { isMarqueeSelecting, marqueeStyle, startMarquee } = useTimelineMarquee(
  containerRef,
  tracks,
  trackHeights,
);

function resolveTimelineDragAction(e: PointerEvent): string {
  const settings = workspaceStore.userSettings.mouse.timeline;
  if (e.button === 1) return settings.middleDrag;
  if (e.button === 0) {
    if (isLayer1Active(e, workspaceStore.userSettings)) return settings.clipDragShift;
    if (isLayer2Active(e, workspaceStore.userSettings)) return settings.clipDragCtrl;
    return settings.drag;
  }
  if (e.button === 2) return settings.clipDragRight;
  return 'none';
}

function shouldStartMarquee(e: PointerEvent): boolean {
  if (props.isMobile) return false;
  if (e.target !== e.currentTarget && !(e.target as HTMLElement).hasAttribute('data-track-id')) {
    return false;
  }
  const action = resolveTimelineDragAction(e);
  return action === 'move_clips' || action === 'select_area';
}

const { resizeVolume, startResizeVolume, startResizeFade, startResizeTransition } =
  useTimelineClipHandleResize(
    () => props.scrollLeft ?? 0,
    () => props.tracks,
  );

const timelineWidthPx = computed(() => {
  const maxUs = timelineStore.duration + 30_000_000;
  return timeUsToPx(maxUs, timelineStore.timelineZoom);
});

const timelineContentStyle = computed(() => {
  const base = { minWidth: `max(100%, ${timelineWidthPx.value}px)` };
  // Desktop scrolls by transforming the content (the outer container does not
  // scroll natively). Mobile lives inside a native overflow-auto scroller, so
  // applying the transform too would double-shift the content and push clips
  // off-screen — scrollLeft is still forwarded for windowing/thumbnail calcs.
  if (props.isMobile) return base;
  return {
    ...base,
    transform: `translate3d(-${props.scrollLeft ?? 0}px, 0, 0)`,
    willChange: 'transform',
  };
});

const selectionRangeStyle = computed(() => {
  const range = timelineStore.getSelectionRange();
  if (!range) return null;
  return {
    left: `${timeUsToPx(range.startUs, timelineStore.timelineZoom)}px`,
    width: `${Math.max(1, timeUsToPx(range.endUs - range.startUs, timelineStore.timelineZoom))}px`,
  };
});

const { movePreviewItemsByTrack, movePreviewIds, movePreviewMemoByTrack } = useTimelineMovePreviews(
  {
    tracks: () => props.tracks,
    movePreview: () => props.movePreview,
    draggingMode: () => props.draggingMode,
  },
);

const trimPreviewByItemId = computed(() => {
  const map: Record<string, TimelineTrimPreview> = {};
  if (!props.trimPreview || props.trimPreview.length === 0) return map;
  for (const preview of props.trimPreview) {
    map[preview.itemId] = preview;
  }
  return map;
});

// Per-track trim-preview memo string. Only affected tracks get an entry, so the
// v-memo key can do an O(1) lookup instead of re-scanning track.items per render.
const trimPreviewMemoByTrack = computed(() => {
  const map: Record<string, string> = {};
  if (!props.trimPreview || props.trimPreview.length === 0) return map;
  const byItemId = trimPreviewByItemId.value;
  for (const track of props.tracks) {
    let parts = '';
    for (const item of track.items) {
      const p = byItemId[item.id];
      if (p) parts += `${item.id}:${p.startUs}:${p.durationUs},`;
    }
    if (parts) map[track.id] = parts;
  }
  return map;
});

// Track that currently holds the grabbed (single) dragged item.
const draggingItemTrackId = computed(() => {
  const id = props.draggingItemId;
  if (!id) return null;
  for (const track of props.tracks) {
    if (track.items.some((i) => i.id === id)) return track.id;
  }
  return null;
});

// Source tracks holding any move-preview item (covers multi-select / cross-track moves).
const movePreviewSourceTracks = computed(() => {
  const set = new Set<string>();
  const ids = movePreviewIds.value;
  if (ids.size === 0) return set;
  for (const track of props.tracks) {
    if (track.items.some((i) => ids.has(i.id))) set.add(track.id);
  }
  return set;
});

// Track holding the slipped item.
const slipPreviewTrackId = computed(() => {
  const id = props.slipPreview?.itemId;
  if (!id) return null;
  for (const track of props.tracks) {
    if (track.items.some((i) => i.id === id)) return track.id;
  }
  return null;
});

const { autoMontageModal, applyAutoMontage, openAutoMontage } = useTimelineAutoMontage(
  () => props.tracks,
);

const { emptyAreaContextMenuItems: timelineEmptyAreaContextMenuItems } =
  useTimelineEmptyAreaContextMenu({
    onZoomToFit: () => props.onZoomToFit?.(),
  });

const {
  isTrackRenameModalOpen,
  trackToRename,
  handleRenameTrack,
  trackContextMenuRef,
  activeTrackContextMenuItems,
  handleTrackContextMenu,
} = useTimelineTrackContextMenu(() => props.tracks);

function selectTransition(
  e: MouseEvent | PointerEvent,
  payload: { trackId: string; itemId: string; edge: 'in' | 'out' },
) {
  e.stopPropagation();

  // On mobile, skip the cycle logic — repeated tap just re-selects the same transition
  if (!props.isMobile) {
    // If this transition is already selected, toggle selection back to the clip
    const current = selectionStore.selectedEntity;
    if (
      current?.source === 'timeline' &&
      current.kind === 'transition' &&
      current.trackId === payload.trackId &&
      current.itemId === payload.itemId &&
      current.edge === payload.edge
    ) {
      timelineStore.selectTransition(null);
      timelineStore.selectTimelineItems([
        { trackId: payload.trackId, itemId: payload.itemId, kind: 'clip' },
      ]);
      return;
    }
  }

  timelineStore.selectTransition(payload);
  selectionStore.selectTimelineTransition(payload.trackId, payload.itemId, payload.edge);
}

function selectTrackById(trackId: string) {
  timelineStore.selectTrack(trackId);
  selectionStore.selectTimelineTrack(trackId);
}

let trackPointerStartX = 0;
let trackPointerStartY = 0;

function onTrackPointerDown(e: PointerEvent, trackId: string) {
  focusStore.setPanelFocus('timeline');
  if (shouldStartMarquee(e)) {
    // Stop propagation so the outer container doesn't call startMarquee without onClick and
    // override our callback. On click (no drag) → select the track; on drag → marquee.
    e.stopPropagation();
    if (!props.isMobile && e.button === 0) {
      startMarquee(e, () => selectTrackById(trackId));
    } else {
      startMarquee(e);
    }
  } else if (e.button === 0) {
    if (props.isMobile) {
      // On mobile, record start position for movement check in click handler
      trackPointerStartX = e.clientX;
      trackPointerStartY = e.clientY;
    } else {
      // Clips/gaps bubble their pointerdown up to the track. Only treat this as
      // a track-background press (select track + clear clip selection) when it
      // did not originate from a clip or gap — otherwise pressing a clip to drag
      // a multi-selection would wipe the selection here, leaving startMoveItem to
      // re-select just the grabbed clip and move only that one.
      const target = e.target as HTMLElement | null;
      const fromClipOrGap = Boolean(
        target?.closest('[data-clip-id]') || target?.closest('[data-gap-id]'),
      );
      if (!fromClipOrGap) {
        selectTrackById(trackId);
        timelineStore.clearSelection();
      }
    }
  }
}

function onTrackClick(e: MouseEvent, trackId: string) {
  if (!props.isMobile) return;
  e.stopPropagation();
  // Skip if this was a scroll gesture (significant pointer movement)
  const dx = Math.abs(e.clientX - trackPointerStartX);
  const dy = Math.abs(e.clientY - trackPointerStartY);
  if (dx > 5 || dy > 5) return;
  // Skip if click originated from a clip or gap child element
  const target = e.target as HTMLElement | null;
  if (target?.closest('[data-clip-id]') || target?.closest('[data-gap-id]')) return;
  selectTrackById(trackId);
  timelineStore.clearSelection();
}

const {
  isPasteParametersModalOpen,
  selectedParameterGroups,
  clipParameterGroupOptions,
  applyClipParameters,
} = useTimelinePasteParameters(() => props.tracks);

defineOptions({
  inheritAttrs: false,
});

watch(
  () => focusStore.effectiveFocus,
  (val) => {
    if (val === 'timeline') {
      containerRef.value?.focus();
    }
  },
);
</script>

<template>
  <UContextMenu :items="timelineEmptyAreaContextMenuItems" :disabled="isMobile">
    <div
      ref="containerRef"
      tabindex="-1"
      v-bind="$attrs"
      class="flex flex-col min-h-full relative outline-none"
      :style="timelineContentStyle"
      @pointerdown="
        focusStore.setPanelFocus('timeline');
        if (!props.isAnyDrawerOpen && shouldStartMarquee($event)) {
          startMarquee($event);
        } else if (
          !props.isAnyDrawerOpen &&
          $event.button !== 1 &&
          $event.target === $event.currentTarget
        ) {
          timelineStore.clearSelection();
          selectionStore.clearSelection();
          timelineStore.selectTrack(null);
        }
      "
      @contextmenu.prevent.stop
    >
      <div
        v-if="selectionRangeStyle"
        class="absolute top-0 bottom-0 z-20 pointer-events-none border-l border-r border-selection-range-border bg-selection-range-bg shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-selection-range)_25%,transparent)]"
        :style="selectionRangeStyle"
      />

      <div
        v-if="isMarqueeSelecting"
        class="absolute border-2 border-primary-500 bg-primary-500/20 pointer-events-none z-50"
        :style="marqueeStyle"
      />

      <AutoMontageModal
        v-if="autoMontageModal"
        v-model:open="autoMontageModal.open"
        @apply="applyAutoMontage"
      />

      <UiContextMenuPortal
        ref="trackContextMenuRef"
        :items="activeTrackContextMenuItems"
        :target-el="containerRef"
        manual
      />

      <div
        v-for="trackViewModel in trackViewModels"
        :key="trackViewModel.track.id"
        v-memo="[
          trackViewModel.track.id,
          trackViewModel.track.locked,
          trackViewModel.track.color,
          trackViewModel.height,
          trackViewModel.isHovered,
          trackViewModel.isDirectlySelected,
          trackViewModel.isVisuallySelected,
          trackViewModel.visibleItems.length,
          trackViewModel.track.videoHidden,
          trackViewModel.track.audioMuted,
          trackViewModel.track.audioSolo,
          timelineStore.timelineZoom,
          timelineStore.isAnyTrackSoloed,
          trackViewModel.clipRenderMemo,
          movePreviewMemoByTrack[trackViewModel.track.id] ?? null,
          dragPreview?.trackId === trackViewModel.track.id ? dragPreview.startUs : null,
          draggingItemTrackId === trackViewModel.track.id ? draggingItemId : null,
          movePreviewSourceTracks.has(trackViewModel.track.id)
            ? (movePreviewMemoByTrack[trackViewModel.track.id] ?? null)
            : null,
          slipPreviewTrackId === trackViewModel.track.id ? (slipPreview?.deltaUs ?? null) : null,
          trimPreviewMemoByTrack[trackViewModel.track.id] ?? null,
        ]"
        :data-track-id="trackViewModel.track.id"
        class="flex items-center relative transition-colors border-b border-ui-border"
        :class="[
          trackViewModel.isHovered && !trackViewModel.isVisuallySelected
            ? 'bg-ui-bg-elevated/50'
            : '',
          trackViewModel.track.locked ? 'hatching-diagonal-track bg-black/10' : '',
          trackViewModel.track.audioMuted ? 'muted-track-dots bg-black/5' : '',
          trackViewModel.isDirectlySelected ? 'track--directly-selected' : '',
          !trackViewModel.isDirectlySelected && trackViewModel.isVisuallySelected
            ? 'track--visually-selected'
            : '',
        ]"
        :style="{
          height: `${trackViewModel.height}px`,
          '--track-selection-color': trackViewModel.selectionColor,
          backgroundColor: trackViewModel.backgroundColor,
        }"
        @pointerdown="onTrackPointerDown($event, trackViewModel.track.id)"
        @click="onTrackClick($event, trackViewModel.track.id)"
        @mouseenter="timelineStore.hoveredTrackId = trackViewModel.track.id"
        @mouseleave="timelineStore.hoveredTrackId = null"
        @dragover.prevent="emit('dragover', $event, trackViewModel.track.id)"
        @drop.prevent="emit('drop', $event, trackViewModel.track.id)"
        @contextmenu="handleTrackContextMenu($event, trackViewModel.track)"
      >
        <!-- Mute sticky overlay icon (always visible on screen horizontally) -->
        <div
          v-if="trackViewModel.track.audioMuted"
          class="sticky left-3 z-30 pointer-events-none shrink-0"
        >
          <div
            class="bg-black/60 rounded-full p-1.5 text-white/50 backdrop-blur-xs flex items-center justify-center"
          >
            <UIcon name="i-heroicons-speaker-x-mark" class="w-4 h-4" />
          </div>
        </div>

        <!-- Drop Previews inside track -->
        <div
          v-if="dragPreview && dragPreview.trackId === trackViewModel.track.id"
          class="absolute top-0.5 bottom-0.5 rounded px-2 flex items-center text-xs text-(--clip-text) z-30 pointer-events-none opacity-80"
          :class="
            dragPreview.kind === 'file'
              ? 'bg-primary-600 border border-primary-400'
              : 'bg-ui-bg-accent border border-ui-border'
          "
          :style="{
            left: `${timeUsToPx(dragPreview.startUs, timelineStore.timelineZoom)}px`,
            width: `${Math.max(2, timeUsToPx(dragPreview.durationUs, timelineStore.timelineZoom))}px`,
          }"
        >
          <span class="truncate" :title="dragPreview.label">{{ dragPreview.label }}</span>
        </div>

        <TimelineClip
          v-for="{ preview, item: previewItem } in movePreviewItemsByTrack[
            trackViewModel.track.id
          ] ?? []"
          :key="`preview-${preview.itemId}`"
          class="opacity-60 pointer-events-none z-40!"
          :track="trackViewModel.track"
          :item="
            {
              ...previewItem,
              id: 'preview-' + previewItem.id,
              timelineRange: { ...previewItem.timelineRange, startUs: preview.startUs },
            } as TimelineTrackItem
          "
          :track-height="trackViewModel.height"
          :can-edit-clip-content="false"
          :is-dragging-current-item="false"
          :is-move-preview-current-item="true"
          :is-move-preview-collision="preview.isCollision"
          :selected-transition="null"
          :resize-volume="null"
        />

        <template v-for="item in trackViewModel.visibleItems" :key="item.id">
          <TimelineGap
            v-if="item.kind === 'gap'"
            :item="item"
            :track-id="trackViewModel.track.id"
            :is-mobile="isMobile"
            @select="(e) => emit('selectItem', e, item.id)"
            @marquee-start="
              (e) => !isMobile && startMarquee(e, () => emit('selectItem', e, item.id))
            "
          />
          <TimelineClip
            v-else
            :track="trackViewModel.track"
            :item="item"
            :track-height="trackViewModel.height"
            :can-edit-clip-content="canEditClipContent"
            :is-dragging-current-item="draggingItemId === item.id"
            :is-move-preview-current-item="movePreviewIds.has(item.id)"
            :is-trim-preview-current-item="Boolean(trimPreviewByItemId[item.id])"
            :selected-transition="selectedTransition"
            :resize-volume="resizeVolume"
            :scroll-left="scrollLeft"
            :viewport-width="viewportWidth"
            :slip-preview="slipPreview?.itemId === item.id ? slipPreview : null"
            :trim-preview="trimPreviewByItemId[item.id] ?? null"
            :is-mobile="isMobile"
            :is-multi-select-mode="isMultiSelectMode"
            @select-item="(ev, id) => emit('selectItem', ev, id)"
            @start-move-item="(ev, payload) => emit('startMoveItem', ev, payload)"
            @start-trim-item="(ev, payload) => emit('startTrimItem', ev, payload)"
            @start-resize-volume="startResizeVolume"
            @start-resize-fade="startResizeFade"
            @start-resize-transition="startResizeTransition"
            @select-transition="selectTransition"
            @clip-action="
              (p) => {
                if (p.action === 'openAutoMontage') {
                  openAutoMontage(p);
                } else if (p.action === 'longPress') {
                  emit('long-press-item', p.itemId);
                } else {
                  emit('clipAction', p);
                }
              }
            "
            @open-speed-modal="(p: TimelineOpenSpeedModalPayload) => emit('open-speed-modal', p)"
            @reset-volume="
              (payload) =>
                timelineStore.updateClipProperties(payload.trackId, payload.itemId, {
                  audioGain: 1,
                })
            "
          />
        </template>
      </div>
      <div class="w-full flex-1 min-h-7" @click="timelineStore.selectTrack(null)" />
      <div class="h-16 shrink-0" />
    </div>
  </UContextMenu>

  <UiRenameModal
    :open="isTrackRenameModalOpen"
    :current-name="trackToRename?.name || ''"
    :title="t('fastcat.timeline.renameTrack')"
    @update:open="isTrackRenameModalOpen = $event"
    @rename="handleRenameTrack"
  />

  <UiRenameModal
    :open="!!uiStore.pendingClipRename"
    :current-name="uiStore.pendingClipRename?.name || ''"
    :title="t('fastcat.clip.rename')"
    @update:open="if (!$event) uiStore.pendingClipRename = null;"
    @rename="
      if (uiStore.pendingClipRename) {
        timelineStore.renameItem(
          uiStore.pendingClipRename.trackId,
          uiStore.pendingClipRename.itemId,
          $event,
        );
        uiStore.pendingClipRename = null;
      }
    "
  />

  <ClipParametersPasteModal
    v-model:open="isPasteParametersModalOpen"
    v-model:selected-groups="selectedParameterGroups"
    :groups="clipParameterGroupOptions"
    @apply="applyClipParameters"
  />
</template>

<style scoped>
/* Псевдоэлементы для подсветки выбора трека вместо лишних DOM-узлов */
[data-track-id]::before,
[data-track-id]::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  transition: background-color 0.2s;
  border-style: solid;
  border-width: 0;
  border-color: transparent;
}

/* Яркая подсветка когда выбран сам хедер трека */
.track--directly-selected::before {
  border-top-width: 2px;
  border-bottom-width: 2px;
  border-color: var(
    --track-selection-color,
    color-mix(in srgb, var(--color-primary-500) 70%, transparent)
  );
  background-color: color-mix(in srgb, var(--color-primary-500) 8%, transparent);
}

/* Мягкая подсветка когда выбран клип на треке */
.track--visually-selected::after {
  border-top-width: 1px;
  border-bottom-width: 1px;
  border-color: var(
    --track-selection-color,
    color-mix(in srgb, var(--color-primary-500) 30%, transparent)
  );
}
</style>
