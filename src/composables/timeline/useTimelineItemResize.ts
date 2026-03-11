import { onBeforeUnmount, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import { pxToDeltaUs, pickBestSnapCandidateUs, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import type { TimelineTrack, TimelineClipItem, ClipTransition } from '~/timeline/types';
import { DEFAULT_TRANSITION_MODE } from '~/transitions';

export function useTimelineItemResize(tracksRef: () => TimelineTrack[]) {
  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();
  const timelineSettingsStore = useTimelineSettingsStore();

  function canEditClipContent(): boolean {
    return (
      projectStore.currentView === 'cut' ||
      projectStore.currentView === 'files' ||
      projectStore.currentView === 'sound'
    );
  }

  let activePointerMove: ((e: PointerEvent) => void) | null = null;
  let activePointerUp: ((e?: PointerEvent) => void) | null = null;
  let activeKeyDown: ((e: KeyboardEvent) => void) | null = null;

  function clearActivePointerListeners() {
    if (activePointerMove) {
      window.removeEventListener('pointermove', activePointerMove);
      activePointerMove = null;
    }
    if (activePointerUp) {
      window.removeEventListener('pointerup', activePointerUp as any);
      activePointerUp = null;
    }
    if (activeKeyDown) {
      window.removeEventListener('keydown', activeKeyDown);
      activeKeyDown = null;
    }
  }

  const resizeTransition = ref<{
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
    startX: number;
    startDurationUs: number;
  } | null>(null);

  const resizeFade = ref<{
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
    startX: number;
    startFadeUs: number;
  } | null>(null);

  const resizeVolume = ref<{
    trackId: string;
    itemId: string;
    startY: number;
    startGain: number;
    trackHeight: number;
  } | null>(null);

  function startResizeVolume(
    e: PointerEvent,
    trackId: string,
    itemId: string,
    currentVolume: number,
    clipHeight: number,
  ) {
    if (!canEditClipContent()) return;
    e.stopPropagation();
    e.preventDefault();
    resizeVolume.value = {
      trackId,
      itemId,
      startY: e.clientY,
      startGain: currentVolume,
      trackHeight: clipHeight,
    };

    clearActivePointerListeners();

    function onPointerMove(ev: PointerEvent) {
      if (!resizeVolume.value) return;
      const dy = ev.clientY - resizeVolume.value.startY;
      const deltaVol = -(dy / resizeVolume.value.trackHeight) * 2;
      let newVol = resizeVolume.value.startGain + deltaVol;
      newVol = Math.max(0, Math.min(2, newVol));

      timelineStore.updateClipProperties(trackId, itemId, {
        audioGain: newVol,
        audioMuted: false,
      });
    }

    function onPointerUp() {
      if (resizeVolume.value) {
        timelineStore.requestTimelineSave({ immediate: true });
      }
      resizeVolume.value = null;
      clearActivePointerListeners();
    }

    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Escape' && resizeVolume.value) {
        timelineStore.updateClipProperties(trackId, itemId, {
          audioGain: resizeVolume.value.startGain,
        });
        resizeVolume.value = null;
        clearActivePointerListeners();
      }
    }

    activePointerMove = onPointerMove;
    activePointerUp = onPointerUp;
    activeKeyDown = onKeyDown;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
  }

  function startResizeFade(
    e: PointerEvent,
    trackId: string,
    itemId: string,
    edge: 'in' | 'out',
    currentFadeUs: number,
  ) {
    if (!canEditClipContent()) return;
    e.stopPropagation();
    e.preventDefault();
    resizeFade.value = {
      trackId,
      itemId,
      edge,
      startX: e.clientX,
      startFadeUs: currentFadeUs,
    };

    clearActivePointerListeners();

    function onPointerMove(ev: PointerEvent) {
      if (!resizeFade.value) return;
      const dx = ev.clientX - resizeFade.value.startX;
      const sign = edge === 'in' ? 1 : -1;
      const deltaPx = dx * sign;
      const deltaUs = pxToDeltaUs(deltaPx, timelineStore.timelineZoom);

      const tracks = tracksRef();
      const track = tracks.find((t) => t.id === trackId);
      const item = track?.items.find((i) => i.id === itemId);
      if (!item || item.kind !== 'clip') return;

      const clipDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));
      const oppFadeUs = Math.max(
        0,
        Math.round(
          edge === 'in' ? ((item as any).audioFadeOutUs ?? 0) : ((item as any).audioFadeInUs ?? 0),
        ),
      );
      const maxUs = Math.max(0, clipDurationUs - oppFadeUs);
      let newFadeUs = resizeFade.value.startFadeUs + deltaUs;
      newFadeUs = Math.max(0, Math.min(maxUs, newFadeUs));

      const propName = edge === 'in' ? 'audioFadeInUs' : 'audioFadeOutUs';
      timelineStore.updateClipProperties(trackId, itemId, {
        [propName]: Math.round(newFadeUs),
      });
    }

    function onPointerUp() {
      if (resizeFade.value) {
        timelineStore.requestTimelineSave({ immediate: true });
      }
      resizeFade.value = null;
      clearActivePointerListeners();
    }

    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Escape' && resizeFade.value) {
        const propName = edge === 'in' ? 'audioFadeInUs' : 'audioFadeOutUs';
        timelineStore.updateClipProperties(trackId, itemId, {
          [propName]: resizeFade.value.startFadeUs,
        });
        resizeFade.value = null;
        clearActivePointerListeners();
      }
    }

    activePointerMove = onPointerMove;
    activePointerUp = onPointerUp;
    activeKeyDown = onKeyDown;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
  }

  function getOrderedClipsOnTrack(track: TimelineTrack): TimelineClipItem[] {
    const clips = track.items.filter((it): it is TimelineClipItem => it.kind === 'clip');
    return [...clips].sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  }

  function getAdjacentClipForTransitionEdge(input: {
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
  }): { clip: TimelineClipItem; adjacent: TimelineClipItem | null } | null {
    const tracks = tracksRef();
    const track = tracks.find((t) => t.id === input.trackId);
    if (!track) return null;
    const ordered = getOrderedClipsOnTrack(track);
    const idx = ordered.findIndex((c) => c.id === input.itemId);
    if (idx === -1) return null;
    const clip = ordered[idx]!;
    const adjacent =
      input.edge === 'in'
        ? idx > 0
          ? ordered[idx - 1]!
          : null
        : idx < ordered.length - 1
          ? ordered[idx + 1]!
          : null;
    return { clip, adjacent };
  }

  function getTransitionAdjacentHandleLimitUs(input: {
    edge: 'in' | 'out';
    adjacent: TimelineClipItem | null;
  }): number {
    if (!input.adjacent) return Number.POSITIVE_INFINITY;

    if (input.edge === 'in') {
      const prev = input.adjacent;
      const prevSourceEnd = (prev.sourceRange?.startUs ?? 0) + (prev.sourceRange?.durationUs ?? 0);
      const prevMaxEnd =
        (prev.clipType === 'media' || prev.clipType === 'timeline') && !prev.isImage
          ? ((prev as any).sourceDurationUs ?? prevSourceEnd)
          : Number.POSITIVE_INFINITY;
      return Number.isFinite(prevMaxEnd)
        ? Math.max(0, Math.round(Number(prevMaxEnd)) - Math.round(prevSourceEnd))
        : Number.POSITIVE_INFINITY;
    }

    return input.adjacent.clipType === 'media' || input.adjacent.clipType === 'timeline'
      ? Math.max(0, Math.round(Number(input.adjacent.sourceRange?.startUs ?? 0)))
      : Number.POSITIVE_INFINITY;
  }

  function computeMaxResizableTransitionDurationUs(input: {
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
    currentTransition: ClipTransition;
  }): number {
    const resolved = getAdjacentClipForTransitionEdge({
      trackId: input.trackId,
      itemId: input.itemId,
      edge: input.edge,
    });
    if (!resolved) return 10_000_000;

    const { clip, adjacent } = resolved;

    const clipDuration = clip.timelineRange.durationUs;
    const oppTransitionUs =
      input.edge === 'in'
        ? ((clip as any).transitionOut?.durationUs ?? 0)
        : ((clip as any).transitionIn?.durationUs ?? 0);
    const maxWithinClip = Math.max(0, clipDuration - oppTransitionUs);

    let limitByHandle = Number.POSITIVE_INFINITY;

    const mode = input.currentTransition.mode ?? DEFAULT_TRANSITION_MODE;
    if (mode === 'transition' && adjacent) {
      limitByHandle = getTransitionAdjacentHandleLimitUs({
        edge: input.edge,
        adjacent,
      });
    }

    if (mode === 'fade') {
      if (input.edge === 'in') {
        limitByHandle =
          clip.clipType === 'media' || clip.clipType === 'timeline'
            ? Math.max(0, Math.round(Number(clip.sourceRange?.startUs ?? 0)))
            : Number.POSITIVE_INFINITY;
      } else {
        const clipSourceEnd =
          (clip.sourceRange?.startUs ?? 0) + (clip.sourceRange?.durationUs ?? 0);
        const clipMaxEnd =
          (clip.clipType === 'media' || clip.clipType === 'timeline') && !clip.isImage
            ? ((clip as any).sourceDurationUs ?? clipSourceEnd)
            : Number.POSITIVE_INFINITY;
        limitByHandle = Number.isFinite(clipMaxEnd)
          ? Math.max(0, Math.round(Number(clipMaxEnd)) - Math.round(clipSourceEnd))
          : Number.POSITIVE_INFINITY;
      }
    }

    return Math.min(maxWithinClip, limitByHandle);
  }

  function computeTransitionHandleSnapDurationUs(input: {
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
    currentTransition: ClipTransition;
    rawDurationUs: number;
  }): number | null {
    const resolved = getAdjacentClipForTransitionEdge({
      trackId: input.trackId,
      itemId: input.itemId,
      edge: input.edge,
    });
    if (!resolved) return null;

    const { clip, adjacent } = resolved;
    const mode = input.currentTransition.mode ?? DEFAULT_TRANSITION_MODE;
    if (mode !== 'transition' || !adjacent) return null;

    const clipEdgeUs =
      input.edge === 'in'
        ? clip.timelineRange.startUs
        : clip.timelineRange.startUs + clip.timelineRange.durationUs;
    const adjacentEdgeUs =
      input.edge === 'in'
        ? adjacent.timelineRange.startUs + adjacent.timelineRange.durationUs
        : adjacent.timelineRange.startUs;
    const gapUs = Math.abs(clipEdgeUs - adjacentEdgeUs);
    if (gapUs > 1_000) return null;

    const handleLimitUs = getTransitionAdjacentHandleLimitUs({
      edge: input.edge,
      adjacent,
    });

    if (!Number.isFinite(handleLimitUs)) return null;
    return Math.max(0, Math.round(handleLimitUs));
  }

  function startResizeTransition(
    e: PointerEvent,
    trackId: string,
    itemId: string,
    edge: 'in' | 'out',
    currentDurationUs: number,
  ) {
    if (!canEditClipContent()) return;
    e.stopPropagation();
    e.preventDefault();
    resizeTransition.value = {
      trackId,
      itemId,
      edge,
      startX: e.clientX,
      startDurationUs: currentDurationUs,
    };

    clearActivePointerListeners();

    function onPointerMove(ev: PointerEvent) {
      if (!resizeTransition.value) return;
      const dx = ev.clientX - resizeTransition.value.startX;
      const sign = edge === 'in' ? 1 : -1;
      const deltaPx = dx * sign;
      const deltaUs = pxToDeltaUs(deltaPx, timelineStore.timelineZoom);
      const minUs = 100_000;

      const tracks = tracksRef();
      const track = tracks.find((t) => t.id === trackId);
      const item = track?.items.find((i) => i.id === itemId);
      if (!item || item.kind !== 'clip') return;

      const current =
        edge === 'in'
          ? (item as TimelineClipItem).transitionIn
          : (item as TimelineClipItem).transitionOut;
      if (!current) return;

      const maxUsRaw = computeMaxResizableTransitionDurationUs({
        trackId,
        itemId,
        edge,
        currentTransition: current,
      });

      const clipDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));
      const oppositeTransitionUs = Math.max(
        0,
        Math.round(
          edge === 'in'
            ? ((item as TimelineClipItem).transitionOut?.durationUs ?? 0)
            : ((item as TimelineClipItem).transitionIn?.durationUs ?? 0),
        ),
      );
      const hardMaxUs = Math.max(minUs, Math.max(0, clipDurationUs - oppositeTransitionUs));

      let newDurationUs = Math.min(
        hardMaxUs,
        Math.max(minUs, resizeTransition.value.startDurationUs + deltaUs),
      );

      if (timelineSettingsStore.clipSnapMode === 'clips') {
        const thresholdUs = Math.round(
          (timelineSettingsStore.snapThresholdPx / zoomToPxPerSecond(timelineStore.timelineZoom)) *
            1e6,
        );
        const handleSnapUs = computeTransitionHandleSnapDurationUs({
          trackId,
          itemId,
          edge,
          currentTransition: current,
          rawDurationUs: newDurationUs,
        });
        if (handleSnapUs !== null) {
          const snap = pickBestSnapCandidateUs({
            rawUs: newDurationUs,
            thresholdUs,
            targetsUs: [handleSnapUs],
          });
          newDurationUs = snap.snappedUs;
        }
      }

      if (maxUsRaw <= 0 && newDurationUs <= 0) return;

      timelineStore.updateClipTransition(trackId, itemId, {
        [edge === 'in' ? 'transitionIn' : 'transitionOut']: {
          ...current,
          durationUs: Math.round(newDurationUs),
        },
      });
    }

    function onPointerUp() {
      if (resizeTransition.value) {
        timelineStore.requestTimelineSave({ immediate: true });
      }
      resizeTransition.value = null;
      clearActivePointerListeners();
    }

    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Escape' && resizeTransition.value) {
        const tracks = tracksRef();
        const track = tracks.find((t) => t.id === trackId);
        const item = track?.items.find((i) => i.id === itemId);
        if (item && item.kind === 'clip') {
          const current = edge === 'in' ? item.transitionIn : item.transitionOut;
          if (current) {
            timelineStore.updateClipTransition(trackId, itemId, {
              [edge === 'in' ? 'transitionIn' : 'transitionOut']: { ...current, durationUs: resizeTransition.value.startDurationUs }
            });
          }
        }
        resizeTransition.value = null;
        clearActivePointerListeners();
      }
    }

    activePointerMove = onPointerMove;
    activePointerUp = onPointerUp;
    activeKeyDown = onKeyDown;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
  }

  onBeforeUnmount(() => {
    clearActivePointerListeners();
    resizeTransition.value = null;
    resizeFade.value = null;
    resizeVolume.value = null;
  });

  return {
    resizeTransition,
    resizeFade,
    resizeVolume,
    startResizeVolume,
    startResizeFade,
    startResizeTransition,
  };
}
