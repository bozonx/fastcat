<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { 
  TimelineTrack, 
  TimelineTrackItem, 
  TimelineClipItem, 
} from '~/timeline/types';
import { useTimelineStore } from '~/stores/timeline.store';
import { useSelectionStore } from '~/stores/selection.store';
import { useProjectStore } from '~/stores/project.store';
import { timeUsToPx } from '~/composables/timeline/useTimelineInteraction';

const { t } = useI18n();
const timelineStore = useTimelineStore();
const selectionStore = useSelectionStore();
const projectStore = useProjectStore();

interface Props {
  track: TimelineTrack;
  item: TimelineTrackItem;
  trackHeight: number;
  isDraggingCurrentItem: boolean;
  isMovePreviewCurrentItem: boolean;
  selectedTransition: { trackId: string; itemId: string; edge: 'in' | 'out' } | null;
  resizeVolume: { itemId: string; trackId: string; startGain: number; startY: number; trackHeight: number } | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'selectItem', event: MouseEvent, itemId: string): void;
  (e: 'startMoveItem', event: MouseEvent, trackId: string, itemId: string, startUs: number): void;
  (e: 'startTrimItem', event: MouseEvent, payload: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number }): void;
  (e: 'startResizeVolume', event: MouseEvent, trackId: string, itemId: string, gain: number, height: number): void;
  (e: 'startResizeFade', event: MouseEvent, trackId: string, itemId: string, edge: 'in' | 'out', durationUs: number): void;
  (e: 'startResizeTransition', event: MouseEvent, trackId: string, itemId: string, edge: 'in' | 'out', durationUs: number): void;
  (e: 'selectTransition', event: MouseEvent, payload: { trackId: string; itemId: string; edge: 'in' | 'out' }): void;
  (e: 'clipAction', payload: any): void;
  (e: 'openSpeedModal', payload: { trackId: string; itemId: string; speed: number }): void;
}>();

const clipWidthPx = computed(() => {
  return Math.max(2, timeUsToPx(props.item.timelineRange.durationUs, timelineStore.timelineZoom));
});

function isVideo(item: TimelineTrackItem): item is TimelineClipItem {
  return item.kind === 'clip' && item.clipType === 'media' && props.track.kind === 'video';
}

function isAudio(item: TimelineTrackItem): item is TimelineClipItem {
  return item.kind === 'clip' && item.clipType === 'media' && props.track.kind === 'audio';
}

function clipHasAudio(item: TimelineTrackItem, track: TimelineTrack): boolean {
  if (track.kind === 'audio') return true;
  if (item.kind !== 'clip') return false;
  return Boolean((item as TimelineClipItem).audioGain !== undefined || (item as any).hasAudio);
}

function getClipClass(item: TimelineTrackItem, track: TimelineTrack): string[] {
  if (item.kind === 'gap') {
    return [
      'border',
      'border-dashed',
      'border-ui-border/50',
      'bg-ui-bg-elevated/20',
      'hover:bg-ui-bg-elevated/40',
      'text-ui-text-muted',
      'transition-colors',
    ];
  }

  const clipItem = item as TimelineClipItem;
  const baseClasses = ['border', 'transition-colors'];

  if (clipItem.clipType === 'background') {
    return [
      ...baseClasses,
      'bg-[var(--clip-background-bg)]',
      'border-[var(--clip-background-border)]',
      'hover:bg-[var(--clip-background-bg-hover)]',
    ];
  }
  if (clipItem.clipType === 'adjustment') {
    return [
      ...baseClasses,
      'bg-[var(--clip-adjustment-bg)]',
      'border-[var(--clip-adjustment-border)]',
      'hover:bg-[var(--clip-adjustment-bg-hover)]',
    ];
  }
  if (track.kind === 'audio') {
    return [
      ...baseClasses,
      'bg-[var(--clip-audio-bg)]',
      'border-[var(--clip-audio-border)]',
      'hover:bg-[var(--clip-audio-bg-hover)]',
    ];
  }

  return [
    ...baseClasses,
    'bg-[var(--clip-video-bg)]',
    'border-[var(--clip-video-border)]',
    'hover:bg-[var(--clip-video-bg-hover)]',
  ];
}

function getClipLowerTriColor(_item: TimelineTrackItem, _track: TimelineTrack): string {
  return 'var(--clip-lower-tri)';
}

function shouldCollapseTransitions(item: TimelineTrackItem): boolean {
  if (item.kind !== 'clip') return false;
  return clipWidthPx.value < 60;
}

function shouldCollapseFades(item: TimelineTrackItem): boolean {
  if (item.kind !== 'clip') return false;
  return clipWidthPx.value < 40;
}

function clampHandlePx(px: number, maxPx: number): number {
  const minSafe = 6;
  const maxSafe = maxPx - 6;
  if (maxSafe < minSafe) return px;
  return Math.min(maxSafe, Math.max(minSafe, px));
}

function transitionUsToPx(us: number) {
  return timeUsToPx(us, timelineStore.timelineZoom);
}

function transitionSvgParts(w: number, h: number, edge: 'in' | 'out'): string {
  const m = h / 2;
  if (edge === 'in') {
    return `M0,0 L${w},${m} L0,${h} Z`;
  } else {
    return `M0,0 L${w},0 L${w},${m} Z M0,${h} L${w},${h} L${w},${m} Z`;
  }
}

function getPrevClipForItem(track: TimelineTrack, item: TimelineTrackItem): TimelineClipItem | null {
  const clips = track.items.filter((it): it is TimelineClipItem => it.kind === 'clip');
  const idx = clips.findIndex((c) => c.id === item.id);
  if (idx <= 0) return null;
  return clips[idx - 1] ?? null;
}

function isCrossfadeTransitionIn(track: TimelineTrack, item: TimelineClipItem): boolean {
  if (track.kind !== 'video') return false;
  const prev = getPrevClipForItem(track, item);
  if (!prev) return false;
  
  const gapUs = item.timelineRange.startUs - (prev.timelineRange.startUs + prev.timelineRange.durationUs);
  if (gapUs > 1000) return false;
  
  const transIn = item.transitionIn;
  if (!transIn) return false;
  return transIn.mode === 'blend';
}

function hasTransitionInProblem(track: TimelineTrack, item: TimelineTrackItem): string | null {
  if (item.kind !== 'clip') return null;
  const clip = item as TimelineClipItem;
  const tr = clip.transitionIn;
  if (!tr) return null;
  const mode = tr.mode ?? 'blend';

  if (mode === 'blend') {
    const prev = getPrevClipForItem(track, item);
    if (!prev) return t('granVideoEditor.timeline.transition.errorNoPreviousClip', 'No previous clip to blend with');
    const prevEndUs = prev.timelineRange.startUs + prev.timelineRange.durationUs;
    const gapUs = clip.timelineRange.startUs - prevEndUs;
    if (gapUs > 1_000) return t('granVideoEditor.timeline.transition.errorGapBetweenClips', { gapSeconds: (gapUs / 1e6).toFixed(2) });
    const prevDurS = prev.timelineRange.durationUs / 1e6;
    const needS = tr.durationUs / 1e6;
    if (prevDurS < needS) return t('granVideoEditor.timeline.transition.errorPrevClipTooShort', { needSeconds: needS.toFixed(2), haveSeconds: prevDurS.toFixed(2) });
    if (prev.clipType === 'media') {
      const prevSourceEnd = (prev.sourceRange?.startUs ?? 0) + (prev.sourceRange?.durationUs ?? 0);
      const prevTimelineEnd = prev.timelineRange.durationUs;
      const handleUs = prevSourceEnd - prevTimelineEnd;
      if (handleUs < tr.durationUs - 1_000) return t('granVideoEditor.timeline.transition.errorPrevHandleTooShort', { needSeconds: needS.toFixed(2), haveSeconds: Math.max(0, handleUs / 1e6).toFixed(2) });
    }
    return null;
  }

  if (mode === 'composite') {
    // Basic check for composite: simplified as in original Tracks
    return null; 
  }
  return null;
}

function hasTransitionOutProblem(track: TimelineTrack, item: TimelineTrackItem): string | null {
  if (item.kind !== 'clip') return null;
  const clip = item as TimelineClipItem;
  const tr = clip.transitionOut;
  if (!tr) return null;
  // Simplified composite check logic can go here if needed
  return null;
}

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
    mainGroup.push({
      label: (item as TimelineClipItem).disabled
        ? t('granVideoEditor.timeline.enableClip', 'Enable clip')
        : t('granVideoEditor.timeline.disableClip', 'Disable clip'),
      icon: (item as TimelineClipItem).disabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash',
      onSelect: async () => {
        timelineStore.updateClipProperties(track.id, (item as TimelineClipItem).id, {
          disabled: !(item as TimelineClipItem).disabled,
        });
        await timelineStore.requestTimelineSave({ immediate: true });
      },
    });

    mainGroup.push({
      label: (item as TimelineClipItem).locked
        ? t('granVideoEditor.timeline.unlockClip', 'Unlock clip')
        : t('granVideoEditor.timeline.lockClip', 'Lock clip'),
      icon: (item as TimelineClipItem).locked ? 'i-heroicons-lock-open' : 'i-heroicons-lock-closed',
      onSelect: async () => {
        timelineStore.updateClipProperties(track.id, (item as TimelineClipItem).id, { locked: !(item as TimelineClipItem).locked });
        await timelineStore.requestTimelineSave({ immediate: true });
      },
    });

    const currentSpeed = (item as TimelineClipItem).speed ?? 1;

    mainGroup.push({
      label: `${t('granVideoEditor.timeline.speed', 'Speed')} (${currentSpeed.toFixed(2)})`,
      icon: 'i-heroicons-forward',
      onSelect: () => emit('openSpeedModal', { trackId: track.id, itemId: (item as TimelineClipItem).id, speed: currentSpeed }),
    });

    const canExtract =
      track.kind === 'video' && (item as TimelineClipItem).clipType === 'media' && !(item as any).audioFromVideoDisabled;
    if (canExtract) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.extractAudio', 'Extract audio to audio track'),
        icon: 'i-heroicons-musical-note',
        onSelect: () =>
          emit('clipAction', { action: 'extractAudio', trackId: track.id, itemId: (item as TimelineClipItem).id }),
      });
    }

    const hasReturnFromVideoClip =
      track.kind === 'video' &&
      Boolean((item as any).audioFromVideoDisabled) &&
      (timelineStore.timelineDoc?.tracks ?? []).some((t: any) =>
        t.kind !== 'audio'
          ? false
          : (t.items ?? []).some(
              (it: any) =>
                it.kind === 'clip' &&
                it.linkedVideoClipId === (item as TimelineClipItem).id &&
                Boolean(it.lockToLinkedVideo),
            ),
      );

    const hasReturnFromLockedAudioClip =
      track.kind === 'audio' && Boolean((item as TimelineClipItem).linkedVideoClipId) && Boolean((item as TimelineClipItem).lockToLinkedVideo);

    if (hasReturnFromVideoClip) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.returnAudio', 'Return audio to video clip'),
        icon: 'i-heroicons-arrow-uturn-left',
        onSelect: () =>
          emit('clipAction', { action: 'returnAudio', trackId: track.id, itemId: (item as TimelineClipItem).id }),
      });
    } else if (hasReturnFromLockedAudioClip) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.returnAudio', 'Return audio to video clip'),
        icon: 'i-heroicons-arrow-uturn-left',
        onSelect: () =>
          emit('clipAction', {
            action: 'returnAudio',
            trackId: track.id,
            itemId: (item as TimelineClipItem).id,
            videoItemId: String((item as TimelineClipItem).linkedVideoClipId),
          }),
      });
    }

    const isMediaVideoClip = track.kind === 'video' && (item as TimelineClipItem).clipType === 'media';
    const hasFreezeFrame = typeof (item as TimelineClipItem).freezeFrameSourceUs === 'number';
    if (isMediaVideoClip && !hasFreezeFrame) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.freezeFrame', 'Freeze frame'),
        icon: 'i-heroicons-pause-circle',
        onSelect: () =>
          emit('clipAction', { action: 'freezeFrame', trackId: track.id, itemId: (item as TimelineClipItem).id }),
      });
    }

    if (isMediaVideoClip && hasFreezeFrame) {
      mainGroup.push({
        label: t('granVideoEditor.timeline.resetFreezeFrame', 'Reset freeze frame'),
        icon: 'i-heroicons-play-circle',
        onSelect: () =>
          emit('clipAction', { action: 'resetFreezeFrame', trackId: track.id, itemId: (item as TimelineClipItem).id }),
      });
    }
  }

  const actionGroup: any[] = [
    {
      label: t('granVideoEditor.timeline.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      disabled: item.kind === 'clip' && Boolean(item.locked),
      onSelect: () => {
        selectionStore.clearSelection();
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
          selectionStore.clearSelection();
        } else {
          const transition = {
            type: 'dissolve',
            durationUs: suggestedDurationUs,
            mode: 'blend' as const,
            curve: 'linear' as const,
          };
          timelineStore.updateClipTransition(track.id, item.id, { transitionIn: transition });
          timelineStore.selectTransition({ trackId: track.id, itemId: item.id, edge: 'in' });
          selectionStore.selectTimelineTransition(track.id, item.id, 'in');
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
          selectionStore.clearSelection();
        } else {
          const transition = {
            type: 'dissolve',
            durationUs: suggestedDurationUs,
            mode: 'blend' as const,
            curve: 'linear' as const,
          };
          timelineStore.updateClipTransition(track.id, item.id, { transitionOut: transition });
          timelineStore.selectTransition({ trackId: track.id, itemId: item.id, edge: 'out' });
          selectionStore.selectTimelineTransition(track.id, item.id, 'out');
        }
      },
    });

    if (transitionGroup.length > 0) result.push(transitionGroup);
  }

  result.push(actionGroup);

  return result;
}

</script>

<template>
  <UContextMenu
    :items="getClipContextMenuItems(track, item)"
  >
    <div
      class="absolute inset-y-0 rounded flex flex-col text-xs text-(--clip-text) z-10 cursor-pointer select-none transition-shadow group/clip"
      :class="[
        timelineStore.selectedItemIds.includes(item.id)
          ? 'ring-2 ring-(--selection-ring) z-20 shadow-lg'
          : '',
        item.kind === 'clip' && typeof (item as any).freezeFrameSourceUs === 'number'
          ? 'outline-(--color-warning) outline-2'
          : '',
        item.kind === 'clip' && (Boolean((item as any).disabled) || Boolean(track.videoHidden))
          ? 'opacity-40'
          : '',
        item.kind === 'clip' && Boolean((item as any).locked) ? 'cursor-not-allowed' : '',
        ...getClipClass(item, track),
      ]"
      :style="{
        left: `${2 + timeUsToPx(item.timelineRange.startUs, timelineStore.timelineZoom)}px`,
        width: `${clipWidthPx}px`,
      }"
      @mousedown="
        item.kind === 'clip' &&
        !Boolean((item as any).locked) &&
        emit('startMoveItem', $event, item.trackId, item.id, item.timelineRange.startUs)
      "
      @pointerdown="
        if ($event.button !== 1) {
          $event.stopPropagation();
          emit('selectItem', $event, item.id);
          selectionStore.selectTimelineItem(track.id, item.id, item.kind as 'clip' | 'gap');
        }
      "
    >
      <!-- Audio Fade Layer -->
      <div
        v-if="item.kind === 'clip' && clipHasAudio(item, track) && !shouldCollapseFades(item)"
        class="absolute inset-0 pointer-events-none z-10 overflow-hidden rounded"
      >
        <svg
          v-if="
            (item as any).audioFadeInUs > 0 &&
            (item as any).audioFadeInUs <= item.timelineRange.durationUs
          "
          class="absolute left-0 top-0 h-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
          :style="{
            width: `${Math.min(
              Math.max(
                0,
                timeUsToPx(
                  Math.max(0, Math.round(Number((item as any).audioFadeInUs) || 0)),
                  timelineStore.timelineZoom,
                ),
              ),
              clipWidthPx,
            )}px`,
          }"
        >
          <polygon points="0,0 100,0 0,100" fill="var(--clip-lower-tri)" />
        </svg>

        <svg
          v-if="
            (item as any).audioFadeOutUs > 0 &&
            (item as any).audioFadeOutUs <= item.timelineRange.durationUs
          "
          class="absolute right-0 top-0 h-full"
          preserveAspectRatio="none"
          viewBox="0 0 100 100"
          :style="{
            width: `${Math.min(
              Math.max(
                0,
                timeUsToPx(
                  Math.max(0, Math.round(Number((item as any).audioFadeOutUs) || 0)),
                  timelineStore.timelineZoom,
                ),
              ),
              clipWidthPx,
            )}px`,
          }"
        >
          <polygon points="0,0 100,0 100,100" fill="var(--clip-lower-tri)" />
        </svg>
      </div>

      <!-- Fade Handles -->
      <template
        v-if="
          item.kind === 'clip' &&
          clipHasAudio(item, track) &&
          !Boolean((item as any).locked) &&
          !shouldCollapseFades(item)
        "
      >
        <div
          class="absolute top-0 w-6 h-6 -ml-3 -translate-y-1/2 transition-opacity z-60 flex items-center justify-center shadow-sm"
          :class="
            clipWidthPx >= 30
              ? 'cursor-ew-resize opacity-0 group-hover/clip:opacity-100'
              : 'hidden pointer-events-none'
          "
          :style="{
            left: `${clampHandlePx(
              Math.min(
                Math.max(
                  0,
                  timeUsToPx((item as any).audioFadeInUs || 0, timelineStore.timelineZoom),
                ),
                clipWidthPx,
              ),
              clipWidthPx,
            )}px`,
          }"
          @mousedown.stop="
            emit('startResizeFade', $event, track.id, item.id, 'in', (item as any).audioFadeInUs || 0)
          "
        >
          <div class="w-2.5 h-2.5 rounded-full bg-white border border-black/30"></div>
        </div>

        <div
          class="absolute top-0 w-6 h-6 -mr-3 -translate-y-1/2 transition-opacity z-60 flex items-center justify-center shadow-sm"
          :class="
            clipWidthPx >= 30
              ? 'cursor-ew-resize opacity-0 group-hover/clip:opacity-100'
              : 'hidden pointer-events-none'
          "
          :style="{
            right: `${clampHandlePx(
              Math.min(
                Math.max(
                  0,
                  timeUsToPx((item as any).audioFadeOutUs || 0, timelineStore.timelineZoom),
                ),
                clipWidthPx,
              ),
              clipWidthPx,
            )}px`,
          }"
          @mousedown.stop="
            emit('startResizeFade', $event, track.id, item.id, 'out', (item as any).audioFadeOutUs || 0)
          "
        >
          <div class="w-2.5 h-2.5 rounded-full bg-white border border-black/30"></div>
        </div>
      </template>

      <!-- Collapsed Indicators -->
      <div
        v-if="
          item.kind === 'clip' &&
          (shouldCollapseTransitions(item) ||
            (clipHasAudio(item, track) && shouldCollapseFades(item)))
        "
        class="absolute top-0.5 left-0.5 flex flex-col gap-0.5 z-40 pointer-events-none"
      >
        <div
          v-if="clipWidthPx >= 30 && clipHasAudio(item, track) && shouldCollapseFades(item) && (item as any).audioFadeInUs > 0"
          class="w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center shadow-sm"
          title="Fade In"
        >
          <UIcon name="i-heroicons-arrow-right" class="w-2.5 h-2.5 text-gray-800" />
        </div>
        <div
          v-if="clipHasAudio(item, track) && shouldCollapseFades(item) && (item as any).audioFadeOutUs > 0"
          class="w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center shadow-sm"
          title="Fade Out"
        >
          <UIcon name="i-heroicons-arrow-left" class="w-2.5 h-2.5 text-gray-800" />
        </div>
        <div
          v-if="shouldCollapseTransitions(item) && (item as any).transitionIn"
          class="w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center shadow-sm"
          title="Transition In"
        >
          <UIcon name="i-heroicons-arrow-right" class="w-2.5 h-2.5 text-white" />
        </div>
        <div
          v-if="shouldCollapseTransitions(item) && (item as any).transitionOut"
          class="w-3.5 h-3.5 rounded-full bg-green-500 flex items-center justify-center shadow-sm"
          title="Transition Out"
        >
          <UIcon name="i-heroicons-arrow-left" class="w-2.5 h-2.5 text-white" />
        </div>
      </div>

      <!-- Volume Control Line -->
      <div
        v-if="item.kind === 'clip' && clipHasAudio(item, track)"
        class="absolute left-0 right-0 z-45 h-3 -mt-1.5 flex flex-col justify-center"
        :class="[
          !Boolean((item as any).locked) ? 'cursor-ns-resize' : '',
          (item as any).audioGain !== undefined && Math.abs((item as any).audioGain - 1) > 0.001
            ? 'opacity-100'
            : timelineStore.selectedItemIds.includes(item.id)
              ? 'opacity-100'
              : 'opacity-0 group-hover/clip:opacity-100',
          (isDraggingCurrentItem || isMovePreviewCurrentItem) &&
          resizeVolume?.itemId !== item.id
            ? 'opacity-0! pointer-events-none'
            : '',
        ]"
        :style="{
          top: `${100 - (((item as any).audioGain ?? 1) / 2) * 100}%`,
        }"
        @mousedown.stop="
          !Boolean((item as any).locked) &&
          emit('startResizeVolume', $event, track.id, item.id, (item as any).audioGain ?? 1, trackHeight)
        "
      >
        <div
          class="w-full h-[1.5px] bg-yellow-400 pointer-events-none opacity-80"
          :class="clipWidthPx >= 15 ? 'group-hover/clip:opacity-100' : 'hidden'"
        ></div>

        <div
          class="absolute left-1/2 -translate-x-1/2 text-[10px] font-mono text-yellow-400 leading-none py-0.5 bg-black/60 px-1 rounded pointer-events-none select-none transition-opacity"
          :class="[
            clipWidthPx < 30
              ? 'hidden'
              : resizeVolume?.itemId === item.id
                ? 'opacity-100 z-50'
                : 'opacity-0 group-hover/clip:opacity-100',
            ((item as any).audioGain ?? 1) > 1 ? 'top-full mt-0.5' : 'bottom-full mb-0.5',
          ]"
        >
          {{ Math.round(((item as any).audioGain ?? 1) * 100) }}%
        </div>
      </div>

      <!-- Speed Indicator -->
      <div
        v-if="item.kind === 'clip' && Math.abs(((item as any).speed ?? 1) - 1) > 0.0001"
        class="absolute top-0.5 right-0.5 px-1 py-0.5 rounded bg-(--overlay-bg) text-[10px] leading-none font-mono z-40"
      >
        x{{ Number((item as any).speed ?? 1).toFixed(2) }}
      </div>

      <!-- Main Content -->
      <div class="flex-1 flex w-full min-h-0 relative z-20">
        <TimelineClipThumbnails
          v-if="isVideo(item)"
          :item="item as any"
          :width="clipWidthPx"
        />

        <TimelineAudioWaveform
          v-if="isAudio(item)"
          :item="item as any"
        />

        <div
          v-if="item.kind === 'clip' && !shouldCollapseTransitions(item)"
          class="absolute bottom-0 left-0 right-0 flex items-end justify-center px-2 pb-0.5 z-0 pointer-events-none"
        >
          <span class="truncate text-[10px] leading-tight opacity-70" :title="item.name">
            {{ item.name }}
          </span>
        </div>

        <!-- Transition In -->
        <div
          v-if="item.kind === 'clip' && (item as any).transitionIn && !shouldCollapseTransitions(item)"
          class="absolute left-0 top-0 bottom-0 z-10"
          :style="{ width: `${transitionUsToPx((item as any).transitionIn.durationUs)}px` }"
        >
          <button
            type="button"
            class="w-full h-full overflow-hidden group/trans"
            :class="[
              selectedTransition?.itemId === item.id && selectedTransition?.edge === 'in'
                ? 'ring-2 ring-inset ring-amber-300 z-10'
                : hasTransitionInProblem(track, item)
                  ? 'ring-2 ring-inset ring-orange-500 z-10'
                  : '',
            ]"
            @click.stop="emit('selectTransition', $event, { trackId: item.trackId, itemId: item.id, edge: 'in' })"
          >
            <template v-if="!isCrossfadeTransitionIn(track, item as any)">
              <svg
                v-if="((item as any).transitionIn.mode ?? 'blend') === 'blend'"
                class="w-full h-full block"
                preserveAspectRatio="none"
                viewBox="0 0 100 100"
              >
                <path
                  :d="transitionSvgParts(100, 100, 'in')"
                  fill="var(--clip-lower-tri)"
                />
              </svg>
              <template v-else>
                <div class="absolute inset-0 bg-linear-to-r from-transparent to-white/20" />
                <span class="i-heroicons-squares-plus w-3 h-3 absolute inset-0 m-auto opacity-70" />
              </template>
            </template>
            <div
              v-if="!Boolean((item as any).locked)"
              class="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 group-hover/trans:bg-white/20 hover:bg-white/40! transition-colors z-40"
              @mousedown.stop="emit('startResizeTransition', $event, item.trackId, item.id, 'in', (item as any).transitionIn.durationUs)"
            />
          </button>
        </div>

        <!-- Transition Out -->
        <div
          v-if="item.kind === 'clip' && (item as any).transitionOut && !shouldCollapseTransitions(item)"
          class="absolute right-0 top-0 bottom-0 z-10"
          :style="{ width: `${transitionUsToPx((item as any).transitionOut.durationUs)}px` }"
        >
          <button
            type="button"
            class="w-full h-full overflow-hidden group/trans"
            :class="[
              selectedTransition?.itemId === item.id && selectedTransition?.edge === 'out'
                ? 'ring-2 ring-inset ring-amber-300 z-10'
                : hasTransitionOutProblem(track, item)
                  ? 'ring-2 ring-inset ring-orange-500 z-10'
                  : '',
            ]"
            @click.stop="emit('selectTransition', $event, { trackId: item.trackId, itemId: item.id, edge: 'out' })"
          >
            <svg
              v-if="((item as any).transitionOut.mode ?? 'blend') === 'blend'"
              class="w-full h-full block"
              preserveAspectRatio="none"
              viewBox="0 0 100 100"
            >
              <path
                :d="transitionSvgParts(100, 100, 'out')"
                fill="var(--clip-lower-tri)"
              />
            </svg>
            <template v-else>
              <div class="absolute inset-0 bg-linear-to-l from-transparent to-white/20" />
              <span class="i-heroicons-squares-plus w-3 h-3 absolute inset-0 m-auto opacity-70" />
            </template>
            <div
              v-if="!Boolean((item as any).locked)"
              class="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 group-hover/trans:bg-white/20 hover:bg-white/40! transition-colors z-40"
              @mousedown.stop="emit('startResizeTransition', $event, item.trackId, item.id, 'out', (item as any).transitionOut.durationUs)"
            />
          </button>
        </div>
      </div>

      <!-- Trim Handles -->
      <div
        v-if="item.kind === 'clip' && !Boolean((item as any).locked)"
        class="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30 transition-colors z-50 group/trim"
        @mousedown.stop="emit('startTrimItem', $event, { trackId: item.trackId, itemId: item.id, edge: 'start', startUs: item.timelineRange.startUs })"
      />
      <div
        v-if="item.kind === 'clip' && !Boolean((item as any).locked)"
        class="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30 transition-colors z-50 group/trim"
        @mousedown.stop="emit('startTrimItem', $event, { trackId: item.trackId, itemId: item.id, edge: 'end', startUs: item.timelineRange.startUs })"
      />
    </div>
  </UContextMenu>
</template>
