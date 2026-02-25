<script setup lang="ts">
import ClipTransitionPanel from './ClipTransitionPanel.vue';
import { ref, computed } from 'vue';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import type { TimelineClipItem, TimelineTrack, TimelineTrackItem } from '~/timeline/types';
import { timeUsToPx, pxToDeltaUs } from '~/composables/timeline/useTimelineInteraction';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const projectStore = useProjectStore();
const { selectedTransition } = storeToRefs(timelineStore);

const props = defineProps<{
  tracks: TimelineTrack[];
  trackHeights: Record<string, number>;
  dragPreview?: {
    trackId: string;
    startUs: number;
    label: string;
    durationUs: number;
    kind: 'timeline-clip' | 'file';
  } | null;
}>();

const DEFAULT_TRACK_HEIGHT = 40;

const emit = defineEmits<{
  (e: 'drop', event: DragEvent, trackId: string): void;
  (e: 'dragover', event: DragEvent, trackId: string): void;
  (e: 'dragleave', event: DragEvent, trackId: string): void;
  (e: 'startMoveItem', event: MouseEvent, trackId: string, itemId: string, startUs: number): void;
  (e: 'selectItem', event: MouseEvent, itemId: string): void;
  (
    e: 'clipAction',
    payload: {
      action: 'extractAudio' | 'returnAudio' | 'freezeFrame' | 'resetFreezeFrame';
      trackId: string;
      itemId: string;
      videoItemId?: string;
    },
  ): void;
  (
    e: 'startTrimItem',
    event: MouseEvent,
    payload: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number },
  ): void;
}>();

// --- Transition panel popup ---
const openTransitionPanel = ref<{
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  anchorEl: HTMLElement | null;
} | null>(null);

function handleTransitionUpdate(payload: {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  transition: import('~/timeline/types').ClipTransition | null;
}) {
  if (payload.edge === 'in') {
    timelineStore.updateClipTransition(payload.trackId, payload.itemId, {
      transitionIn: payload.transition,
    });
  } else {
    timelineStore.updateClipTransition(payload.trackId, payload.itemId, {
      transitionOut: payload.transition,
    });
  }
  openTransitionPanel.value = null;
}

function selectTransition(
  e: MouseEvent,
  input: { trackId: string; itemId: string; edge: 'in' | 'out' },
) {
  e.stopPropagation();
  timelineStore.selectTransition(input);
}

function transitionUsToPx(durationUs: number | undefined): number {
  const safeUs = typeof durationUs === 'number' && Number.isFinite(durationUs) ? durationUs : 0;
  return Math.max(8, timeUsToPx(Math.max(0, safeUs), timelineStore.timelineZoom));
}

// --- Resize transition by dragging ---
const resizeTransition = ref<{
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  startX: number;
  startDurationUs: number;
} | null>(null);

function getOrderedClipsOnTrack(track: TimelineTrack): TimelineClipItem[] {
  const clips = track.items.filter((it): it is TimelineClipItem => it.kind === 'clip');
  return [...clips].sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
}

function getAdjacentClipForTransitionEdge(input: {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
}): { clip: TimelineClipItem; adjacent: TimelineClipItem | null } | null {
  const track = props.tracks.find((t) => t.id === input.trackId);
  if (!track) return null;
  const ordered = getOrderedClipsOnTrack(track);
  const idx = ordered.findIndex((c) => c.id === input.itemId);
  if (idx === -1) return null;
  const clip = ordered[idx]!;
  const adjacent = input.edge === 'in' ? (idx > 0 ? ordered[idx - 1]! : null) : idx < ordered.length - 1 ? ordered[idx + 1]! : null;
  return { clip, adjacent };
}

function computeMaxResizableTransitionDurationUs(input: {
  trackId: string;
  itemId: string;
  edge: 'in' | 'out';
  currentTransition: import('~/timeline/types').ClipTransition;
}): number {
  const resolved = getAdjacentClipForTransitionEdge({
    trackId: input.trackId,
    itemId: input.itemId,
    edge: input.edge,
  });
  if (!resolved) return 10_000_000;

  const { clip, adjacent } = resolved;
  if (!adjacent) return 0;

  // Only enforce hard max for blend crossfades (needs overlap material)
  const mode = input.currentTransition.mode ?? 'blend';
  if (mode !== 'blend') return 10_000_000;

  if (input.edge === 'in') {
    // We're resizing transitionIn of `clip` => crossfade uses previous clip tail handle.
    const prev = adjacent;
    const prevSourceEnd = (prev.sourceRange?.startUs ?? 0) + (prev.sourceRange?.durationUs ?? 0);
    const prevMaxEnd = prev.clipType === 'media' ? (prev as any).sourceDurationUs ?? prevSourceEnd : Number.POSITIVE_INFINITY;
    const prevTailHandleUs = Number.isFinite(prevMaxEnd)
      ? Math.max(0, Math.round(Number(prevMaxEnd)) - Math.round(prevSourceEnd))
      : 10_000_000;
    return Math.max(0, Math.min(10_000_000, prevTailHandleUs));
  }

  // Resizing transitionOut of `clip` => uses this clip tail handle.
  const curr = clip;
  const currSourceEnd = (curr.sourceRange?.startUs ?? 0) + (curr.sourceRange?.durationUs ?? 0);
  const currMaxEnd = curr.clipType === 'media' ? (curr as any).sourceDurationUs ?? currSourceEnd : Number.POSITIVE_INFINITY;
  const currTailHandleUs = Number.isFinite(currMaxEnd)
    ? Math.max(0, Math.round(Number(currMaxEnd)) - Math.round(currSourceEnd))
    : 10_000_000;
  return Math.max(0, Math.min(10_000_000, currTailHandleUs));
}

function startResizeTransition(
  e: MouseEvent,
  trackId: string,
  itemId: string,
  edge: 'in' | 'out',
  currentDurationUs: number,
) {
  e.stopPropagation();
  e.preventDefault();
  resizeTransition.value = {
    trackId,
    itemId,
    edge,
    startX: e.clientX,
    startDurationUs: currentDurationUs,
  };

  function onMouseMove(ev: MouseEvent) {
    if (!resizeTransition.value) return;
    const dx = ev.clientX - resizeTransition.value.startX;
    // For 'in' edge: drag right = longer, drag left = shorter
    // For 'out' edge: drag left = longer (towards start), drag right = shorter
    const sign = edge === 'in' ? 1 : -1;
    const deltaPx = dx * sign;
    const deltaUs = pxToDeltaUs(deltaPx, timelineStore.timelineZoom);
    const minUs = 100_000; // 0.1s

    const track = props.tracks.find((t) => t.id === trackId);
    const item = track?.items.find((i) => i.id === itemId);
    if (!item || item.kind !== 'clip') return;

    const current =
      edge === 'in'
        ? (item as TimelineClipItem).transitionIn
        : (item as TimelineClipItem).transitionOut;
    if (!current) return;

    const maxUs = computeMaxResizableTransitionDurationUs({
      trackId,
      itemId,
      edge,
      currentTransition: current,
    });

    const newDurationUs = Math.min(
      maxUs,
      Math.max(minUs, resizeTransition.value.startDurationUs + deltaUs),
    );

    timelineStore.updateClipTransition(trackId, itemId, {
      [edge === 'in' ? 'transitionIn' : 'transitionOut']: {
        ...current,
        durationUs: Math.round(newDurationUs),
      },
    });
  }

  function onMouseUp() {
    resizeTransition.value = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}

// --- Problem detection: previous clip too short for blend transition ---
function getPrevClipForItem(
  track: TimelineTrack,
  item: TimelineTrackItem,
): TimelineClipItem | null {
  const clips = track.items.filter(
    (it): it is TimelineClipItem => it.kind === 'clip',
  );
  const idx = clips.findIndex((c) => c.id === item.id);
  if (idx <= 0) return null;
  return clips[idx - 1] ?? null;
}

function hasTransitionInProblem(track: TimelineTrack, item: TimelineTrackItem): string | null {
  if (item.kind !== 'clip') return null;
  const clip = item as TimelineClipItem;
  const tr = clip.transitionIn;
  if (!tr) return null;
  const mode = tr.mode ?? 'blend';

  if (mode === 'blend') {
    const prev = getPrevClipForItem(track, item);
    if (!prev) return 'No previous clip to blend with';

    // Gap check: clips must be adjacent (no gap > 0)
    const prevEndUs = prev.timelineRange.startUs + prev.timelineRange.durationUs;
    const gapUs = clip.timelineRange.startUs - prevEndUs;
    if (gapUs > 1_000) {
      return `Gap between clips (${(gapUs / 1_000_000).toFixed(2)}s). Blend requires adjacent clips.`;
    }

    // Duration check: prev clip must be long enough
    const prevDurS = prev.timelineRange.durationUs / 1_000_000;
    const needS = tr.durationUs / 1_000_000;
    if (prevDurS < needS) {
      return t('granVideoEditor.timeline.transition.errorPrevClipTooShort', {
        need: needS.toFixed(2),
        have: prevDurS.toFixed(2),
      });
    }

    // Handle material check for media video clips only
    if (prev.kind === 'clip' && prev.clipType === 'media') {
      const prevClip = prev as TimelineClipItem;
      const prevSourceEnd = (prevClip.sourceRange?.startUs ?? 0) + (prevClip.sourceRange?.durationUs ?? 0);
      const prevTimelineEnd = prevClip.timelineRange.durationUs;
      const handleUs = prevSourceEnd - prevTimelineEnd;
      if (handleUs < tr.durationUs - 1_000) {
        const haveS = Math.max(0, handleUs / 1_000_000);
        return `Previous clip has insufficient handle material (needs ${needS.toFixed(2)}s, has ${haveS.toFixed(2)}s beyond out-point)`;
      }
    }

    return null;
  }

  if (mode === 'composite') {
    const transitionStart = clip.timelineRange.startUs;
    const transitionEnd = transitionStart + tr.durationUs;
    const myTrackIdx = props.tracks.findIndex((t) => t.id === track.id);
    for (let i = myTrackIdx + 1; i < props.tracks.length; i++) {
      const lowerTrack = props.tracks[i]!;
      for (const it of lowerTrack.items) {
        if (it.kind !== 'clip') continue;
        const itStart = it.timelineRange.startUs;
        const itEnd = itStart + it.timelineRange.durationUs;
        if (itStart < transitionStart && itEnd > transitionStart && itEnd < transitionEnd) {
          return 'A lower-track clip ends mid-transition (composite blend will be incomplete)';
        }
      }
    }
    return null;
  }

  return null;
}

function hasTransitionOutProblem(track: TimelineTrack, item: TimelineTrackItem): string | null {
  if (item.kind !== 'clip') return null;
  const clip = item as TimelineClipItem;
  const tr = clip.transitionOut;
  if (!tr) return null;
  const mode = tr.mode ?? 'blend';

  if (mode === 'composite') {
    const clipEnd = clip.timelineRange.startUs + clip.timelineRange.durationUs;
    const outStart = clipEnd - tr.durationUs;
    const myTrackIdx = props.tracks.findIndex((t) => t.id === track.id);
    for (let i = myTrackIdx + 1; i < props.tracks.length; i++) {
      const lowerTrack = props.tracks[i]!;
      for (const it of lowerTrack.items) {
        if (it.kind !== 'clip') continue;
        const itStart = it.timelineRange.startUs;
        const itEnd = itStart + it.timelineRange.durationUs;
        // Lower clip starts within the transition-out window and ends after the current clip
        if (itStart > outStart && itStart < clipEnd && itEnd > clipEnd) {
          return 'A lower-track clip starts mid-transition (composite blend will be incomplete)';
        }
      }
    }
  }
  return null;
}

// --- Transition visual helpers ---

/** Upper triangle color based on clip type (same as clip bg) */
function getClipUpperTriColor(item: TimelineTrackItem, track: TimelineTrack): string {
  if (item.kind !== 'clip') return 'rgba(255,255,255,0.35)';
  const clipItem = item as TimelineClipItem;
  if (clipItem.clipType === 'background') return 'rgba(167,139,250,0.45)'; // purple
  if (clipItem.clipType === 'adjustment') return 'rgba(251,191,36,0.45)';  // amber
  if (track.kind === 'audio') return 'rgba(20,184,166,0.5)';              // teal
  return 'rgba(99,102,241,0.5)';                                           // indigo
}

/** Lower triangle: darker variant */
function getClipLowerTriColor(_item: TimelineTrackItem, _track: TimelineTrack): string {
  return 'rgba(0,0,0,0.35)';
}

function transitionSvgParts(
  w: number,
  h: number,
  edge: 'in' | 'out',
  curve: 'linear' | 'bezier',
): { tri1: string; tri2: string; midLine: string } {
  const m = h / 2;
  if (edge === 'in') {
    // Upper tri: apex left-center, base on right (previous clip recedes right)
    // Lower tri: apex right-center, base on left (current clip grows in)
    return {
      tri1: `M0,${m} L${w},0 L${w},${h} Z`,
      tri2: `M${w},${m} L0,0 L0,${h} Z`,
      midLine:
        curve === 'bezier'
          ? `M0,${m} C${w * 0.35},${m * 0.1} ${w * 0.65},${m * 1.9} ${w},${m}`
          : `M0,${m} L${w},${m}`,
    };
  } else {
    // Upper tri: apex right-center, base on left (current clip leaves to left)
    // Lower tri: apex left-center, base on right (next clip coming)
    return {
      tri1: `M${w},${m} L0,0 L0,${h} Z`,
      tri2: `M0,${m} L${w},0 L${w},${h} Z`,
      midLine:
        curve === 'bezier'
          ? `M0,${m} C${w * 0.35},${m * 1.9} ${w * 0.65},${m * 0.1} ${w},${m}`
          : `M0,${m} L${w},${m}`,
    };
  }
}

// --- Context menu ---
function getClipContextMenuItems(track: TimelineTrack, item: any) {
  if (!item) return [];

  if (item.kind === 'gap') {
    return [
      [
        {
          label: t('granVideoEditor.timeline.delete', 'Delete'),
          icon: 'i-heroicons-trash',
          onSelect: () => {
            timelineStore.applyTimeline({
              type: 'delete_items',
              trackId: track.id,
              itemIds: [item.id],
            });
          },
        },
      ],
    ];
  }

  const mainGroup: any[] = [];

  if (item.kind === 'clip') {
    const canExtract =
      track.kind === 'video' && item.clipType === 'media' && !item.audioFromVideoDisabled;
    if (canExtract) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.extractAudio', 'Extract audio to audio track'),
        icon: 'i-heroicons-musical-note',
        onSelect: () =>
          emit('clipAction', { action: 'extractAudio', trackId: track.id, itemId: item.id }),
      });
    }

    const hasReturnFromVideoClip =
      track.kind === 'video' &&
      Boolean(item.audioFromVideoDisabled) &&
      (timelineStore.timelineDoc?.tracks ?? []).some((t: any) =>
        t.kind !== 'audio'
          ? false
          : (t.items ?? []).some(
              (it: any) =>
                it.kind === 'clip' &&
                it.linkedVideoClipId === item.id &&
                Boolean(it.lockToLinkedVideo),
            ),
      );

    const hasReturnFromLockedAudioClip =
      track.kind === 'audio' && Boolean(item.linkedVideoClipId) && Boolean(item.lockToLinkedVideo);

    if (hasReturnFromVideoClip) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.returnAudio', 'Return audio to video clip'),
        icon: 'i-heroicons-arrow-uturn-left',
        onSelect: () =>
          emit('clipAction', { action: 'returnAudio', trackId: track.id, itemId: item.id }),
      });
    } else if (hasReturnFromLockedAudioClip) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.returnAudio', 'Return audio to video clip'),
        icon: 'i-heroicons-arrow-uturn-left',
        onSelect: () =>
          emit('clipAction', {
            action: 'returnAudio',
            trackId: track.id,
            itemId: item.id,
            videoItemId: String(item.linkedVideoClipId),
          }),
      });
    }

    const isMediaVideoClip = track.kind === 'video' && item.clipType === 'media';
    const hasFreezeFrame = typeof item.freezeFrameSourceUs === 'number';
    if (isMediaVideoClip && !hasFreezeFrame) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.freezeFrame', 'Freeze frame'),
        icon: 'i-heroicons-pause-circle',
        onSelect: () =>
          emit('clipAction', { action: 'freezeFrame', trackId: track.id, itemId: item.id }),
      });
    }

    if (isMediaVideoClip && hasFreezeFrame) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.resetFreezeFrame', 'Reset freeze frame'),
        icon: 'i-heroicons-play-circle',
        onSelect: () =>
          emit('clipAction', { action: 'resetFreezeFrame', trackId: track.id, itemId: item.id }),
      });
    }
  }

  const actionGroup: any[] = [
    {
      label: t('granVideoEditor.timeline.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      onSelect: () => {
        timelineStore.applyTimeline({
          type: 'delete_items',
          trackId: track.id,
          itemIds: [item.id],
        });
      },
    },
  ];

  const result = [];
  if (mainGroup.length > 0) result.push(mainGroup);

  if (item.kind === 'clip' && track.kind === 'video') {
    const transitionGroup: any[] = [];
    const hasIn = Boolean((item as any).transitionIn);
    const hasOut = Boolean((item as any).transitionOut);

    const defaultTransitionDurationUs = Math.max(
      0,
      Math.round(Number(projectStore.projectSettings?.transitions?.defaultDurationUs ?? 2_000_000)),
    );
    const clipDurationUs = Math.max(0, Math.round(Number(item.timelineRange?.durationUs ?? 0)));
    const suggestedDurationUs =
      clipDurationUs > 0 && clipDurationUs < defaultTransitionDurationUs
        ? Math.round(clipDurationUs * 0.3)
        : defaultTransitionDurationUs;

    transitionGroup.push({
      label: hasIn
        ? t('granVideoEditor.timeline.removeTransitionIn')
        : t('granVideoEditor.timeline.addTransitionIn'),
      icon: hasIn ? 'i-heroicons-x-circle' : 'i-heroicons-arrow-left-end-on-rectangle',
      onSelect: () => {
        if (hasIn) {
          timelineStore.updateClipTransition(track.id, item.id, { transitionIn: null });
        } else {
          const transition = {
            type: 'dissolve',
            durationUs: suggestedDurationUs,
            mode: 'blend' as const,
            curve: 'linear' as const,
          };
          timelineStore.updateClipTransition(track.id, item.id, { transitionIn: transition });
          timelineStore.selectTransition({ trackId: track.id, itemId: item.id, edge: 'in' });
        }
      },
    });

    transitionGroup.push({
      label: hasOut
        ? t('granVideoEditor.timeline.removeTransitionOut')
        : t('granVideoEditor.timeline.addTransitionOut'),
      icon: hasOut ? 'i-heroicons-x-circle' : 'i-heroicons-arrow-right-end-on-rectangle',
      onSelect: () => {
        if (hasOut) {
          timelineStore.updateClipTransition(track.id, item.id, { transitionOut: null });
        } else {
          const transition = {
            type: 'dissolve',
            durationUs: suggestedDurationUs,
            mode: 'blend' as const,
            curve: 'linear' as const,
          };
          timelineStore.updateClipTransition(track.id, item.id, { transitionOut: transition });
          timelineStore.selectTransition({ trackId: track.id, itemId: item.id, edge: 'out' });
        }
      },
    });

    if (transitionGroup.length > 0) result.push(transitionGroup);
  }

  result.push(actionGroup);

  return result;
}

function getTransitionForPanel() {
  if (!openTransitionPanel.value) return undefined;
  const track = props.tracks.find((t) => t.id === openTransitionPanel.value!.trackId);
  const item = track?.items.find((i) => i.id === openTransitionPanel.value!.itemId);
  if (!item || item.kind !== 'clip') return undefined;
  return openTransitionPanel.value!.edge === 'in'
    ? (item as TimelineClipItem).transitionIn
    : (item as TimelineClipItem).transitionOut;
}
</script>

<template>
  <div
    class="flex flex-col divide-y divide-gray-700"
    @mousedown="
      timelineStore.clearSelection();
      timelineStore.selectTrack(null);
    "
  >
    <div
      v-for="track in tracks"
      :key="track.id"
      :data-track-id="track.id"
      class="flex items-center px-2 relative"
      :class="timelineStore.selectedTrackId === track.id ? 'bg-gray-850/60' : ''"
      :style="{ height: `${trackHeights[track.id] ?? DEFAULT_TRACK_HEIGHT}px` }"
      @dragover.prevent="emit('dragover', $event, track.id)"
      @dragleave.prevent="emit('dragleave', $event, track.id)"
      @drop.prevent="emit('drop', $event, track.id)"
    >
      <div
        v-if="dragPreview && dragPreview.trackId === track.id"
        class="absolute inset-y-1 rounded px-2 flex items-center text-xs text-white z-30 pointer-events-none opacity-80"
        :class="
          dragPreview.kind === 'file'
            ? 'bg-primary-600 border border-primary-400'
            : 'bg-gray-600 border border-gray-400'
        "
        :style="{
          left: `${2 + timeUsToPx(dragPreview.startUs, timelineStore.timelineZoom)}px`,
          width: `${Math.max(30, timeUsToPx(dragPreview.durationUs, timelineStore.timelineZoom))}px`,
        }"
      >
        <span class="truncate" :title="dragPreview.label">{{ dragPreview.label }}</span>
      </div>

      <div
        class="absolute inset-y-1 left-2 right-2 rounded bg-gray-800 border border-dashed border-gray-700 flex items-center justify-center"
      >
        <span v-if="track.items.length === 0" class="text-xs text-gray-700">
          {{ t('granVideoEditor.timeline.dropClip', 'Drop clip here') }}
        </span>
      </div>

      <UContextMenu
        v-for="item in track.items"
        :key="item.id"
        :items="getClipContextMenuItems(track, item)"
      >
        <div
          class="absolute inset-y-1 rounded px-2 flex items-center text-xs text-white z-10 cursor-pointer select-none transition-shadow"
          :class="[
            item.kind === 'gap'
              ? 'bg-gray-800/20 border border-dashed border-gray-700 text-gray-500 opacity-70'
              : item.kind === 'clip' && (item as any).clipType === 'background'
                ? 'border border-purple-400 hover:bg-purple-700/60 bg-purple-800/50'
                : item.kind === 'clip' && (item as any).clipType === 'adjustment'
                  ? 'border border-amber-400 hover:bg-amber-700/60 bg-amber-800/50'
                  : track.kind === 'audio'
                    ? 'bg-teal-600 border border-teal-400 hover:bg-teal-500'
                    : 'bg-indigo-600 border border-indigo-400 hover:bg-indigo-500',
            timelineStore.selectedItemIds.includes(item.id)
              ? 'ring-2 ring-white z-20 shadow-lg'
              : '',
            item.kind === 'clip' && typeof (item as any).freezeFrameSourceUs === 'number'
              ? 'outline outline-2 outline-yellow-400/80'
              : '',
          ]"
          :style="{
            left: `${2 + timeUsToPx(item.timelineRange.startUs, timelineStore.timelineZoom)}px`,
            width: `${Math.max(30, timeUsToPx(item.timelineRange.durationUs, timelineStore.timelineZoom))}px`,
          }"
          @mousedown="
            item.kind === 'clip' &&
            emit('startMoveItem', $event, item.trackId, item.id, item.timelineRange.startUs)
          "
          @click.stop="emit('selectItem', $event, item.id)"
        >
          <!-- Transition In block -->
          <template v-if="item.kind === 'clip' && (item as any).transitionIn">
            <button
              type="button"
              class="absolute left-0 top-0 bottom-0 z-20 overflow-hidden"
              :class="[
                selectedTransition?.itemId === item.id &&
                selectedTransition?.trackId === item.trackId &&
                selectedTransition?.edge === 'in'
                  ? 'ring-2 ring-amber-300'
                  : '',
                hasTransitionInProblem(track, item) ? 'ring-2 ring-orange-500' : '',
              ]"
              :style="{ width: `${transitionUsToPx((item as any).transitionIn?.durationUs)}px` }"
              :title="
                hasTransitionInProblem(track, item) ??
                `Transition In: ${(item as any).transitionIn?.type}`
              "
              @click="selectTransition($event, { trackId: item.trackId, itemId: item.id, edge: 'in' })"
              @dblclick="
                openTransitionPanel = {
                  trackId: item.trackId,
                  itemId: item.id,
                  edge: 'in',
                  anchorEl: $event.currentTarget as HTMLElement,
                }
              "
            >
              <!-- SVG blend visualization -->
              <svg
                v-if="((item as any).transitionIn?.mode ?? 'blend') === 'blend'"
                class="w-full h-full"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                <!-- Upper triangle: same color as clip (incoming clip fills from right) -->
                <path
                  :d="transitionSvgParts(100, 100, 'in', (item as any).transitionIn?.curve ?? 'linear').tri1"
                  :fill="getClipUpperTriColor(item, track)"
                />
                <!-- Lower triangle: dark (previous clip recedes) -->
                <path
                  :d="transitionSvgParts(100, 100, 'in', (item as any).transitionIn?.curve ?? 'linear').tri2"
                  :fill="getClipLowerTriColor(item, track)"
                />
                <!-- Mid line (bezier or straight) -->
                <path
                  :d="transitionSvgParts(100, 100, 'in', (item as any).transitionIn?.curve ?? 'linear').midLine"
                  fill="none"
                  stroke="rgba(255,255,255,0.7)"
                  stroke-width="2.5"
                  stroke-linecap="round"
                />
              </svg>
              <!-- Composite mode: gradient + icon -->
              <template v-else>
                <div class="absolute inset-0 bg-linear-to-r from-transparent to-white/20" />
                <span class="i-heroicons-squares-plus w-3 h-3 absolute inset-0 m-auto opacity-70" />
              </template>

              <!-- Error indicator dot -->
              <div
                v-if="hasTransitionInProblem(track, item)"
                class="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-orange-500"
              />

              <!-- Resize handle on right edge of transition-in -->
              <div
                class="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30 transition-colors z-30"
                @mousedown.stop="
                  startResizeTransition(
                    $event,
                    item.trackId,
                    item.id,
                    'in',
                    (item as any).transitionIn?.durationUs ?? 500_000,
                  )
                "
              />
            </button>
          </template>

          <!-- Transition Out block -->
          <template v-if="item.kind === 'clip' && (item as any).transitionOut">
            <button
              type="button"
              class="absolute right-0 top-0 bottom-0 z-20 overflow-hidden"
              :class="[
                selectedTransition?.itemId === item.id &&
                selectedTransition?.trackId === item.trackId &&
                selectedTransition?.edge === 'out'
                  ? 'ring-2 ring-amber-300'
                  : '',
                hasTransitionOutProblem(track, item) ? 'ring-2 ring-orange-500' : '',
              ]"
              :style="{ width: `${transitionUsToPx((item as any).transitionOut?.durationUs)}px` }"
              :title="
                hasTransitionOutProblem(track, item) ??
                `Transition Out: ${(item as any).transitionOut?.type}`
              "
              @click="selectTransition($event, { trackId: item.trackId, itemId: item.id, edge: 'out' })"
              @dblclick="
                openTransitionPanel = {
                  trackId: item.trackId,
                  itemId: item.id,
                  edge: 'out',
                  anchorEl: $event.currentTarget as HTMLElement,
                }
              "
            >
              <!-- SVG blend visualization -->
              <svg
                v-if="((item as any).transitionOut?.mode ?? 'blend') === 'blend'"
                class="w-full h-full"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                <!-- Upper triangle: clip color (outgoing) -->
                <path
                  :d="transitionSvgParts(100, 100, 'out', (item as any).transitionOut?.curve ?? 'linear').tri1"
                  :fill="getClipUpperTriColor(item, track)"
                />
                <!-- Lower triangle: dark (next arrives from right) -->
                <path
                  :d="transitionSvgParts(100, 100, 'out', (item as any).transitionOut?.curve ?? 'linear').tri2"
                  :fill="getClipLowerTriColor(item, track)"
                />
                <!-- Mid line -->
                <path
                  :d="transitionSvgParts(100, 100, 'out', (item as any).transitionOut?.curve ?? 'linear').midLine"
                  fill="none"
                  stroke="rgba(255,255,255,0.7)"
                  stroke-width="2.5"
                  stroke-linecap="round"
                />
              </svg>
              <!-- Composite mode -->
              <template v-else>
                <div class="absolute inset-0 bg-linear-to-l from-transparent to-white/20" />
                <span class="i-heroicons-squares-plus w-3 h-3 absolute inset-0 m-auto opacity-70" />
              </template>

              <!-- Resize handle on left edge of transition-out -->
              <div
                class="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30 transition-colors z-30"
                @mousedown.stop="
                  startResizeTransition(
                    $event,
                    item.trackId,
                    item.id,
                    'out',
                    (item as any).transitionOut?.durationUs ?? 500_000,
                  )
                "
              />
            </button>
          </template>

          <div
            v-if="item.kind === 'clip'"
            class="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/30 hover:bg-white/50"
            @mousedown="
              emit('startTrimItem', $event, {
                trackId: item.trackId,
                itemId: item.id,
                edge: 'start',
                startUs: item.timelineRange.startUs,
              })
            "
          />
          <span class="truncate" :title="item.kind === 'clip' ? item.name : ''">{{
            item.kind === 'clip' ? item.name : ''
          }}</span>
          <div
            v-if="item.kind === 'clip'"
            class="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/30 hover:bg-white/50"
            @mousedown="
              emit('startTrimItem', $event, {
                trackId: item.trackId,
                itemId: item.id,
                edge: 'end',
                startUs: item.timelineRange.startUs,
              })
            "
          />
        </div>
      </UContextMenu>
    </div>
  </div>

  <!-- Transition panel popup (double-click to open, click outside to close) -->
  <div
    v-if="openTransitionPanel"
    class="fixed inset-0 z-50"
    @mousedown.self="openTransitionPanel = null"
  >
    <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 shadow-xl">
      <ClipTransitionPanel
        :edge="openTransitionPanel.edge"
        :track-id="openTransitionPanel.trackId"
        :item-id="openTransitionPanel.itemId"
        :transition="getTransitionForPanel()"
        @update="handleTransitionUpdate"
      />
    </div>
  </div>
</template>
