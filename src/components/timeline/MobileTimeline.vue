<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import type {
  TimelineClipActionPayload,
  TimelineMoveItemPayload,
  TimelineTrimItemPayload,
  TimelineTrack,
} from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useFocusStore } from '~/stores/focus.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useTimelineInteraction } from '~/composables/timeline/useTimelineInteraction';
import {
  computeAnchoredScrollLeft,
  timeUsToPx,
  pxToTimeUs,
  type TimelineZoomAnchor,
} from '~/utils/timeline/geometry';
import { timelineZoomPositionToScale, timelineZoomScaleToPosition } from '~/utils/zoom';

import TimelineTracks from './TimelineTracks.vue';
import TimelineRuler from './TimelineRuler.vue';
import TimelineGrid from './TimelineGrid.vue';
import MobileTimelineToolbar from './MobileTimelineToolbar.vue';
import MobileClipPropertiesDrawer from './MobileClipPropertiesDrawer.vue';
import TrackProperties from '~/components/properties/TrackProperties.vue';
import MarkerProperties from '~/components/properties/MarkerProperties.vue';


const { t } = useI18n();
const toast = useToast();

const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const mediaStore = useMediaStore();
const focusStore = useFocusStore();
const projectStore = useProjectStore();
const selectionStore = useSelectionStore();

const { currentView } = storeToRefs(projectStore);
const { selectedEntity } = storeToRefs(selectionStore);

const canEditClipContent = computed(
  () =>
    currentView.value === 'cut' || currentView.value === 'files' || currentView.value === 'sound',
);

const tracks = computed(
  () => (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [],
);

const selectedTrack = computed(() => {
  if (!timelineStore.selectedTrackId) return null;
  return tracks.value.find((t) => t.id === timelineStore.selectedTrackId) || null;
});

const selectedTrackNumber = computed(() => {
  if (!selectedTrack.value) return 1;
  const filtered = tracks.value.filter((t) => t.kind === selectedTrack.value!.kind);
  return filtered.indexOf(selectedTrack.value) + 1;
});

const isTrackPropertiesDrawerOpen = ref(false);
const isClipPropertiesDrawerOpen = ref(false);
const isMarkerPropertiesDrawerOpen = ref(false);

const selectedMarkerId = computed(() => {
  if (selectedEntity.value?.source === 'timeline' && selectedEntity.value.kind === 'marker') {
    const markerId = selectedEntity.value.markerId;
    if (timelineStore.markers.some((m) => m.id === markerId)) {
      return markerId;
    }
  }
  return null;
});

watch(
  () => !!timelineStore.selectedTrackId && timelineStore.selectedItemIds.length === 0,
  (val) => {
    isTrackPropertiesDrawerOpen.value = val;
  },
  { immediate: true },
);

watch(
  () => timelineStore.selectedItemIds.length > 0,
  (val) => {
    isClipPropertiesDrawerOpen.value = val;
  },
  { immediate: true },
);

watch(
  () => !!selectedMarkerId.value,
  (val) => {
    isMarkerPropertiesDrawerOpen.value = val;
  },
  { immediate: true },
);

function onUpdateDrawerOpen(val: boolean) {
  if (!val && timelineStore.selectedTrackId) {
    timelineStore.selectTrack(null);
  }
}

function onClipPropertiesDrawerClose() {
  isClipPropertiesDrawerOpen.value = false;
  timelineStore.clearSelection();
}

function onMarkerPropertiesDrawerClose() {
  isMarkerPropertiesDrawerOpen.value = false;
  selectionStore.clearSelection();
}

// --- Track quick actions ---

const isTrackDeleteConfirmOpen = ref(false);
const isTrackRenameOpen = ref(false);

const isTrackFirstOfKind = computed(() => {
  if (!selectedTrack.value) return true;
  return tracks.value.filter((t) => t.kind === selectedTrack.value!.kind)[0]?.id === selectedTrack.value.id;
});

const isTrackLastOfKind = computed(() => {
  if (!selectedTrack.value) return true;
  const kindTracks = tracks.value.filter((t) => t.kind === selectedTrack.value!.kind);
  return kindTracks[kindTracks.length - 1]?.id === selectedTrack.value.id;
});

const trackGain = computed(() => {
  if (!selectedTrack.value) return 100;
  const gain = typeof selectedTrack.value.audioGain === 'number' ? selectedTrack.value.audioGain : 1;
  return Math.round(Math.max(0, Math.min(4, gain)) * 100);
});

function handleTrackGainInput(event: Event) {
  if (!selectedTrack.value) return;
  const val = (event.target as HTMLInputElement).valueAsNumber;
  timelineStore.updateTrackProperties(selectedTrack.value.id, {
    audioGain: Math.max(0, Math.min(4, val / 100)),
  });
}

function toggleTrackLock() {
  if (!selectedTrack.value) return;
  timelineStore.updateTrackProperties(selectedTrack.value.id, { locked: !selectedTrack.value.locked });
  timelineStore.requestTimelineSave({ immediate: true });
}

function toggleTrackVideoHidden() {
  if (!selectedTrack.value) return;
  timelineStore.updateTrackProperties(selectedTrack.value.id, {
    videoHidden: !selectedTrack.value.videoHidden,
  });
  timelineStore.requestTimelineSave({ immediate: true });
}

function toggleTrackMute() {
  if (!selectedTrack.value) return;
  timelineStore.toggleTrackAudioMuted(selectedTrack.value.id);
  timelineStore.requestTimelineSave({ immediate: true });
}

function toggleTrackSolo() {
  if (!selectedTrack.value) return;
  timelineStore.toggleTrackAudioSolo(selectedTrack.value.id);
  timelineStore.requestTimelineSave({ immediate: true });
}

function moveSelectedTrackUp() {
  if (!selectedTrack.value) return;
  timelineStore.moveTrackUp(selectedTrack.value.id);
}

function moveSelectedTrackDown() {
  if (!selectedTrack.value) return;
  timelineStore.moveTrackDown(selectedTrack.value.id);
}

function requestDeleteTrack() {
  if (!selectedTrack.value) return;
  const skipConfirm = workspaceStore.userSettings.deleteWithoutConfirmation;
  if (selectedTrack.value.items.length === 0 || skipConfirm) {
    timelineStore.deleteTrack(selectedTrack.value.id);
  } else {
    isTrackDeleteConfirmOpen.value = true;
  }
}

function confirmDeleteTrack() {
  if (!selectedTrack.value) return;
  timelineStore.deleteTrack(selectedTrack.value.id, { allowNonEmpty: true });
  isTrackDeleteConfirmOpen.value = false;
}


const scrollEl = ref<HTMLElement | null>(null);

const trackHeights = computed(() => {
  const heights: Record<string, number> = {};
  for (const t of tracks.value) {
    // Mobile optimized heights: video tracks are taller for easier manipulation
    heights[t.id] = t.kind === 'video' ? 64 : 48;
  }
  return heights;
});

const playheadPx = computed(() =>
  Math.round(timeUsToPx(timelineStore.currentTime, timelineStore.timelineZoom)),
);

const pendingZoomAnchor = ref<TimelineZoomAnchor | null>(null);

const {
  draggingMode,
  draggingItemId,
  movePreview,
  onTimeRulerPointerDown,
  selectItem,
  startMoveItem,
  startTrimItem,
} = useTimelineInteraction(scrollEl, tracks);

function onStartMoveItem(event: PointerEvent, payload: TimelineMoveItemPayload) {
  startMoveItem(event, {
    trackId: payload.trackId,
    itemId: payload.itemId,
    startUs: payload.startUs,
  });
}

function onStartTrimItem(event: PointerEvent, payload: TimelineTrimItemPayload) {
  startTrimItem(event, payload);
}

function getViewportWidth(): number {
  return scrollEl.value?.clientWidth ?? 0;
}

function makePlayheadAnchor(params: { zoom: number }): TimelineZoomAnchor {
  const viewportWidth = getViewportWidth();
  const prevScrollLeft = scrollEl.value?.scrollLeft ?? 0;
  const playheadPx = timeUsToPx(timelineStore.currentTime, params.zoom);
  const isVisible = playheadPx >= prevScrollLeft && playheadPx <= prevScrollLeft + viewportWidth;
  return {
    anchorTimeUs: timelineStore.currentTime,
    anchorViewportX: isVisible ? playheadPx - prevScrollLeft : viewportWidth / 2,
  };
}

function applyZoomWithAnchor(params: { nextZoom: number; anchor: TimelineZoomAnchor }) {
  pendingZoomAnchor.value = params.anchor;
  timelineStore.setTimelineZoom(params.nextZoom);
}

let initialDistance = 0;
let initialZoomPosition = 1;

function getDistance(touches: TouchList) {
  const t0 = touches[0] as Touch;
  const t1 = touches[1] as Touch;
  const dx = t0.clientX - t1.clientX;
  const dy = t0.clientY - t1.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function onTouchStart(e: TouchEvent) {
  if (e.touches.length === 2) {
    initialDistance = getDistance(e.touches);
    initialZoomPosition = timelineStore.timelineZoom;
  }
}

function onTouchMove(e: TouchEvent) {
  if (e.touches.length === 2) {
    e.preventDefault();
    const currentDistance = getDistance(e.touches);
    if (initialDistance === 0) return;

    const initialScale = timelineZoomPositionToScale(initialZoomPosition);
    const scaleRatio = currentDistance / initialDistance;
    const nextScale = initialScale * scaleRatio;
    const nextZoomPosition = timelineZoomScaleToPosition(nextScale);

    const el = scrollEl.value;
    if (el) {
      const rect = el.getBoundingClientRect();
      const midpointX = ((e.touches[0] as Touch).clientX + (e.touches[1] as Touch).clientX) / 2;
      const viewportX = midpointX - rect.left;
      const anchorPx = el.scrollLeft + viewportX;
      const anchorTimeUs = pxToTimeUs(anchorPx, initialZoomPosition);

      applyZoomWithAnchor({
        nextZoom: nextZoomPosition,
        anchor: { anchorTimeUs, anchorViewportX: viewportX },
      });
    }
  }
}

const clickStartX = ref(0);
const clickStartY = ref(0);

function onTimelinePointerDownCapture(e: PointerEvent) {
  if (e.button === 0) {
    clickStartX.value = e.clientX;
    clickStartY.value = e.clientY;
  }
}

function onTimelineClick(e: MouseEvent) {
  if (e.button !== 0) return;
  const dx = Math.abs(e.clientX - clickStartX.value);
  const dy = Math.abs(e.clientY - clickStartY.value);
  if (dx > 3 || dy > 3) return;

  const target = e.target as HTMLElement | null;
  if (target?.closest('button')) return;
  if (target?.closest('.cursor-ew-resize')) return;
  if (target?.closest('.cursor-ns-resize')) return;
  if (target?.closest('[data-clip-id]')) return;
  if (target?.closest('[data-gap-id]')) return;

  const el = scrollEl.value;
  if (!el) return;

  const docTracks = (timelineStore.timelineDoc?.tracks as TimelineTrack[] | undefined) ?? [];
  const tracksHeight = Object.values(trackHeights.value).reduce((a, b) => a + b, 0);

  const scrollerRectY = el.getBoundingClientRect();
  const y = e.clientY - scrollerRectY.top + el.scrollTop;
  if (y > tracksHeight + 32) {
    timelineStore.selectTimelineProperties();
    return;
  }

  const scrollerRect = el.getBoundingClientRect();
  const scrollX = el.scrollLeft;
  const x = e.clientX - scrollerRect.left + scrollX;

  timelineStore.setCurrentTimeUs(pxToTimeUs(x, timelineStore.timelineZoom));
}

// Ensure the playhead starts in view if zooming happens from other causes
watch(
  () => timelineStore.timelineZoom,
  (nextZoom, prevZoom) => {
    const el = scrollEl.value;
    if (!el) return;
    if (!Number.isFinite(prevZoom)) return;
    if (nextZoom === prevZoom) return;

    const prevScrollLeft = el.scrollLeft;
    const viewportWidth = el.clientWidth;
    const anchor = pendingZoomAnchor.value ?? makePlayheadAnchor({ zoom: prevZoom });
    pendingZoomAnchor.value = null;

    const nextScrollLeft = computeAnchoredScrollLeft({
      prevZoom,
      nextZoom,
      prevScrollLeft,
      viewportWidth,
      anchor,
    });
    el.scrollLeft = nextScrollLeft;
  },
  { flush: 'post' },
);

async function onClipAction(payload: TimelineClipActionPayload) {
  try {
    if (payload.action === 'extractAudio') {
      await timelineStore.extractAudioToTrack({
        videoTrackId: payload.trackId,
        videoItemId: payload.itemId,
      });
    } else if (payload.action === 'freezeFrame') {
      timelineStore.setClipFreezeFrameFromPlayhead({
        trackId: payload.trackId,
        itemId: payload.itemId,
      });
    } else if (payload.action === 'resetFreezeFrame') {
      timelineStore.resetClipFreezeFrame({
        trackId: payload.trackId,
        itemId: payload.itemId,
      });
    } else {
      timelineStore.returnAudioToVideo({ videoItemId: payload.videoItemId ?? payload.itemId });
    }
    await timelineStore.requestTimelineSave({ immediate: true });
  } catch (err: unknown) {
    toast.add({
      title: t('common.error', 'Error'),
      description: err instanceof Error ? err.message : String(err ?? ''),
      icon: 'i-heroicons-exclamation-triangle',
      color: 'error',
    });
  }
}
</script>

<template>
  <div
    class="flex flex-col h-full bg-ui-bg-elevated relative overflow-hidden"
    @pointerdown="focusStore.setMainFocus('timeline')"
  >
    <MobileTimelineToolbar />
    
    <!-- Clip Properties Drawer -->
    <MobileClipPropertiesDrawer
      :is-open="isClipPropertiesDrawerOpen"
      @close="onClipPropertiesDrawerClose"
    />

    <!-- Track Properties Drawer -->
    <UiMobileDrawer
      v-model:open="isTrackPropertiesDrawerOpen"
      :snap-points="[0.46, 0.88]"
      direction="bottom"
      @update:open="onUpdateDrawerOpen"
    >
      <template #header>
        <div class="flex items-center gap-2">
          <div
            v-if="selectedTrack"
            class="w-6 h-6 rounded shrink-0 flex items-center justify-center font-black text-[10px]"
            :style="{
              backgroundColor: selectedTrack.color && selectedTrack.color !== '#2a2a2a' ? `${selectedTrack.color}33` : '#1e293b',
              color: selectedTrack.color && selectedTrack.color !== '#2a2a2a' ? selectedTrack.color : '#94a3b8'
            }"
          >
            {{ selectedTrack.kind === 'video' ? 'V' : 'A' }}{{ selectedTrackNumber }}
          </div>

          <span v-if="selectedTrack" class="text-sm font-bold text-slate-200 truncate flex-1 leading-none">
            {{ selectedTrack.name || selectedTrack.id }}
          </span>
        </div>
      </template>

      <div v-if="selectedTrack" class="pb-6">
        <!-- Quick action buttons grid -->
        <div class="px-4 pt-3 pb-4">
          <div class="grid grid-cols-4 gap-2 mb-3">
            <!-- Rename -->
            <button
              class="flex flex-col items-center justify-center gap-1.5 rounded-xl p-2.5 text-center transition-all outline-none active:scale-95 bg-slate-900/80 border border-slate-800 text-slate-200 min-h-[62px]"
              @click="isTrackRenameOpen = true"
            >
              <UIcon name="lucide:pencil" class="w-5 h-5 shrink-0" />
              <span class="text-[10px] font-medium leading-tight">{{ $t('common.rename', 'Rename') }}</span>
            </button>

            <!-- Delete -->
            <button
              class="flex flex-col items-center justify-center gap-1.5 rounded-xl p-2.5 text-center transition-all outline-none active:scale-95 text-red-400 bg-red-500/10 min-h-[62px]"
              @click="requestDeleteTrack"
            >
              <UIcon name="lucide:trash-2" class="w-5 h-5 shrink-0" />
              <span class="text-[10px] font-medium leading-tight">{{ $t('common.delete', 'Delete') }}</span>
            </button>

            <!-- Lock / Unlock -->
            <button
              class="flex flex-col items-center justify-center gap-1.5 rounded-xl p-2.5 text-center transition-all outline-none active:scale-95 min-h-[62px]"
              :class="selectedTrack.locked
                ? 'text-primary-400 bg-primary-500/10 border border-primary-500/30'
                : 'text-slate-200 bg-slate-900/80 border border-slate-800'"
              @click="toggleTrackLock"
            >
              <UIcon :name="selectedTrack.locked ? 'lucide:lock-open' : 'lucide:lock'" class="w-5 h-5 shrink-0" />
              <span class="text-[10px] font-medium leading-tight">
                {{ selectedTrack.locked ? $t('fastcat.track.unlock', 'Unlock') : $t('fastcat.track.lock', 'Lock') }}
              </span>
            </button>

            <!-- Hide / Show (video) -->
            <button
              v-if="selectedTrack.kind === 'video'"
              class="flex flex-col items-center justify-center gap-1.5 rounded-xl p-2.5 text-center transition-all outline-none active:scale-95 min-h-[62px]"
              :class="selectedTrack.videoHidden
                ? 'text-amber-400 bg-amber-500/10 border border-amber-500/30'
                : 'text-slate-200 bg-slate-900/80 border border-slate-800'"
              @click="toggleTrackVideoHidden"
            >
              <UIcon :name="selectedTrack.videoHidden ? 'i-heroicons-eye-slash' : 'i-heroicons-eye'" class="w-5 h-5 shrink-0" />
              <span class="text-[10px] font-medium leading-tight">
                {{ selectedTrack.videoHidden ? $t('fastcat.timeline.showTrack', 'Show') : $t('fastcat.timeline.hideTrack', 'Hide') }}
              </span>
            </button>
            <!-- Placeholder for audio tracks to keep grid alignment -->
            <div v-else class="min-h-[62px]" />

            <!-- Mute / Unmute -->
            <button
              class="flex flex-col items-center justify-center gap-1.5 rounded-xl p-2.5 text-center transition-all outline-none active:scale-95 min-h-[62px]"
              :class="selectedTrack.audioMuted
                ? 'text-amber-400 bg-amber-500/10 border border-amber-500/30'
                : 'text-slate-200 bg-slate-900/80 border border-slate-800'"
              @click="toggleTrackMute"
            >
              <UIcon :name="selectedTrack.audioMuted ? 'i-heroicons-speaker-x-mark' : 'i-heroicons-speaker-wave'" class="w-5 h-5 shrink-0" />
              <span class="text-[10px] font-medium leading-tight">
                {{ selectedTrack.audioMuted ? $t('fastcat.track.unmute', 'Unmute') : $t('fastcat.track.mute', 'Mute') }}
              </span>
            </button>

            <!-- Solo -->
            <button
              class="flex flex-col items-center justify-center gap-1.5 rounded-xl p-2.5 text-center transition-all outline-none active:scale-95 min-h-[62px]"
              :class="selectedTrack.audioSolo
                ? 'text-primary-400 bg-primary-500/10 border border-primary-500/30'
                : 'text-slate-200 bg-slate-900/80 border border-slate-800'"
              @click="toggleTrackSolo"
            >
              <UIcon name="i-heroicons-musical-note" class="w-5 h-5 shrink-0" />
              <span class="text-[10px] font-medium leading-tight">{{ $t('fastcat.track.solo', 'Solo') }}</span>
            </button>

            <!-- Move Up -->
            <button
              class="flex flex-col items-center justify-center gap-1.5 rounded-xl p-2.5 text-center transition-all outline-none min-h-[62px]"
              :class="isTrackFirstOfKind
                ? 'opacity-35 pointer-events-none text-slate-200 bg-slate-900/80 border border-slate-800'
                : 'active:scale-95 text-slate-200 bg-slate-900/80 border border-slate-800'"
              @click="moveSelectedTrackUp"
            >
              <UIcon name="lucide:arrow-up" class="w-5 h-5 shrink-0" />
              <span class="text-[10px] font-medium leading-tight">{{ $t('fastcat.track.moveUp', 'Move up') }}</span>
            </button>

            <!-- Move Down -->
            <button
              class="flex flex-col items-center justify-center gap-1.5 rounded-xl p-2.5 text-center transition-all outline-none min-h-[62px]"
              :class="isTrackLastOfKind
                ? 'opacity-35 pointer-events-none text-slate-200 bg-slate-900/80 border border-slate-800'
                : 'active:scale-95 text-slate-200 bg-slate-900/80 border border-slate-800'"
              @click="moveSelectedTrackDown"
            >
              <UIcon name="lucide:arrow-down" class="w-5 h-5 shrink-0" />
              <span class="text-[10px] font-medium leading-tight">{{ $t('fastcat.track.moveDown', 'Move down') }}</span>
            </button>
          </div>

          <!-- Track volume slider -->
          <div class="flex items-center gap-3 rounded-xl bg-slate-900/80 border border-slate-800 px-3 py-2.5">
            <UIcon name="i-heroicons-speaker-wave" class="w-4 h-4 text-slate-400 shrink-0" />
            <span class="text-xs text-slate-400 font-mono w-8 tabular-nums text-right shrink-0">{{ trackGain }}</span>
            <input
              :value="trackGain"
              type="range"
              min="0"
              max="400"
              step="1"
              class="flex-1 accent-primary-500"
              :disabled="Boolean(selectedTrack.audioMuted)"
              :class="{ 'opacity-40 pointer-events-none': selectedTrack.audioMuted }"
              @input="handleTrackGainInput"
            />
          </div>
        </div>

        <!-- Separator before full properties -->
        <div class="mx-4 border-t border-slate-800/60 mb-4" />

        <!-- Full track properties -->
        <div class="px-4">
          <TrackProperties :track="selectedTrack" />
        </div>
      </div>

      <UiConfirmModal
        v-model:open="isTrackDeleteConfirmOpen"
        :title="$t('fastcat.timeline.deleteTrackTitle', 'Delete track?')"
        :description="$t('fastcat.timeline.deleteTrackDescription', 'Track is not empty. This action cannot be undone.')"
        color="error"
        icon="i-heroicons-exclamation-triangle"
        :confirm-text="$t('common.delete', 'Delete')"
        @confirm="confirmDeleteTrack"
      />

      <UiRenameModal
        :open="isTrackRenameOpen"
        :current-name="selectedTrack?.name || ''"
        :title="$t('fastcat.timeline.renameTrack', 'Rename track')"
        @update:open="isTrackRenameOpen = $event"
        @rename="(name) => {
          if (selectedTrack) timelineStore.renameTrack(selectedTrack.id, name);
          isTrackRenameOpen = false;
        }"
      />
    </UiMobileDrawer>

    <UiMobileDrawer
      v-model:open="isMarkerPropertiesDrawerOpen"
      :title="t('fastcat.timeline.marker', 'Marker')"
      :snap-points="[0.4, 0.85]"
      direction="bottom"
      @update:open="(val) => !val && onMarkerPropertiesDrawerClose()"
    >
      <div class="px-4 pb-4 overflow-y-auto max-h-[70vh]">
        <MarkerProperties v-if="selectedMarkerId" :marker-id="selectedMarkerId" />
      </div>
    </UiMobileDrawer>

    <!-- Tracks area -->
    <div class="flex-1 relative overflow-hidden">

      <!-- Ruler: outside scrollEl — not scrolled, draws based on scrollEl.scrollLeft -->
      <div
        class="absolute top-0 left-0 right-0 h-8 z-40 bg-ui-bg/95 border-b border-ui-border select-none touch-none backdrop-blur shadow-sm"
      >
        <TimelineRuler
          class="touch-none w-full h-full"
          :scroll-el="scrollEl"
          @pointerdown="onTimeRulerPointerDown"
        />
      </div>

      <!-- Grid: outside scrollEl — covers tracks area, draws based on scrollEl.scrollLeft -->
      <TimelineGrid
        class="absolute left-0 right-0 bottom-0 pointer-events-none z-0"
        style="top: 32px"
        :scroll-el="scrollEl"
      />

      <!-- Main scrollable tracks area: starts below ruler (top-8 = 32px) -->
      <div
        ref="scrollEl"
        class="absolute top-8 left-0 right-0 bottom-0 overflow-auto overscroll-none touch-pan-x touch-pan-y no-scrollbar"
        @touchstart.passive="onTouchStart"
        @touchmove="onTouchMove"
        @pointerdown.capture="onTimelinePointerDownCapture"
        @click="onTimelineClick"
      >
        <div class="relative min-w-max h-full">
          <TimelineTracks
            class="min-w-full"
            :tracks="tracks"
            :track-heights="trackHeights"
            :can-edit-clip-content="canEditClipContent"
            :dragging-mode="draggingMode"
            :dragging-item-id="draggingItemId"
            :move-preview="movePreview"
            is-mobile
            @select-item="selectItem"
            @start-move-item="onStartMoveItem"
            @start-trim-item="onStartTrimItem"
            @clip-action="onClipAction"
          />

          <!-- Playhead line (ruler renders its own triangle marker) -->
          <div
            class="absolute inset-y-0 w-px bg-red-500 shadow-[0_0_2px_rgba(239,68,68,0.5)] z-30 pointer-events-none timeline-playhead"
            :style="{ left: `${playheadPx}px` }"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline-playhead {
  will-change: transform;
}
.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
</style>
