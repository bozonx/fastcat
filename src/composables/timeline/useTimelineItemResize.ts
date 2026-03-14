import { onBeforeUnmount, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineSettingsStore } from '~/stores/timelineSettings.store';
import { pxToDeltaUs, pickBestSnapCandidateUs, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import type {
  TimelineTrack,
  TimelineClipItem,
  ClipTransition,
  TimelineResizeFadePayload,
  TimelineResizeVolumePayload,
} from '~/timeline/types';
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
  let pendingResizeFrame = 0;
  let pendingResizeUpdate: (() => void) | null = null;

  function flushPendingResizeUpdate() {
    pendingResizeFrame = 0;
    const update = pendingResizeUpdate;
    pendingResizeUpdate = null;
    update?.();
  }

  function scheduleResizeUpdate(update: () => void) {
    pendingResizeUpdate = update;
    if (pendingResizeFrame !== 0) return;
    pendingResizeFrame = requestAnimationFrame(flushPendingResizeUpdate);
  }

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
    if (pendingResizeFrame !== 0) {
      cancelAnimationFrame(pendingResizeFrame);
      pendingResizeFrame = 0;
    }
    pendingResizeUpdate = null;
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
    startCurve: 'linear' | 'logarithmic';
    activeCurve: 'linear' | 'logarithmic';
  } | null>(null);

  const resizeVolume = ref<{
    trackId: string;
    itemId: string;
    startY: number;
    startGain: number;
    trackHeight: number;
  } | null>(null);

  function startResizeVolume(e: PointerEvent, payload: TimelineResizeVolumePayload) {
    if (!canEditClipContent()) return;
    e.stopPropagation();
    e.preventDefault();
    resizeVolume.value = {
      trackId: payload.trackId,
      itemId: payload.itemId,
      startY: e.clientY,
      startGain: payload.gain,
      trackHeight: payload.trackHeight,
    };

    clearActivePointerListeners();

    function onPointerMove(ev: PointerEvent) {
      if (!resizeVolume.value) return;
      const dy = ev.clientY - resizeVolume.value.startY;
      const deltaVol = -(dy / resizeVolume.value.trackHeight) * 2;
      let newVol = resizeVolume.value.startGain + deltaVol;
      newVol = Math.max(0, Math.min(2, newVol));

      scheduleResizeUpdate(() => {
        timelineStore.updateClipProperties(payload.trackId, payload.itemId, {
          audioGain: newVol,
          audioMuted: false,
        });
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
        timelineStore.updateClipProperties(payload.trackId, payload.itemId, {
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

  function startResizeFade(e: PointerEvent, payload: TimelineResizeFadePayload) {
    if (!canEditClipContent()) return;
    e.stopPropagation();
    e.preventDefault();

    const tracks = tracksRef();
    const track = tracks.find((t) => t.id === payload.trackId);
    const item = track?.items.find((i) => i.id === payload.itemId);
    if (!item || item.kind !== 'clip') return;

    const curveProp = payload.edge === 'in' ? 'audioFadeInCurve' : 'audioFadeOutCurve';
    const startCurve = item[curveProp] === 'logarithmic' ? 'logarithmic' : 'linear';

    resizeFade.value = {
      trackId: payload.trackId,
      itemId: payload.itemId,
      edge: payload.edge,
      startX: e.clientX,
      startFadeUs: payload.durationUs,
      startCurve,
      activeCurve: startCurve,
    };

    clearActivePointerListeners();

    function onPointerMove(ev: PointerEvent) {
      if (!resizeFade.value) return;
      const dx = ev.clientX - resizeFade.value.startX;
      const sign = payload.edge === 'in' ? 1 : -1;
      const deltaPx = dx * sign;
      const deltaUs = pxToDeltaUs(deltaPx, timelineStore.timelineZoom);

      const tracks = tracksRef();
      const track = tracks.find((t) => t.id === payload.trackId);
      const item = track?.items.find((i) => i.id === payload.itemId);
      if (!item || item.kind !== 'clip') return;

      const clipDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));
      const oppFadeUs = Math.max(
        0,
        Math.round(
          payload.edge === 'in'
            ? ((item as any).audioFadeOutUs ?? 0)
            : ((item as any).audioFadeInUs ?? 0),
        ),
      );
      const maxUs = Math.max(0, clipDurationUs - oppFadeUs);
      let newFadeUs = resizeFade.value.startFadeUs + deltaUs;
      newFadeUs = Math.max(0, Math.min(maxUs, newFadeUs));

      const propName = payload.edge === 'in' ? 'audioFadeInUs' : 'audioFadeOutUs';
      const nextCurve = ev.shiftKey
        ? resizeFade.value.startCurve === 'logarithmic'
          ? 'linear'
          : 'logarithmic'
        : resizeFade.value.startCurve;
      const curveChanged = nextCurve !== resizeFade.value.activeCurve;
      const curveProp = payload.edge === 'in' ? 'audioFadeInCurve' : 'audioFadeOutCurve';

      resizeFade.value.activeCurve = nextCurve;
      const nextFadeUs = Math.round(newFadeUs);
      scheduleResizeUpdate(() => {
        timelineStore.updateClipProperties(payload.trackId, payload.itemId, {
          [propName]: nextFadeUs,
          ...(curveChanged ? { [curveProp]: nextCurve } : {}),
        });
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
        const propName = payload.edge === 'in' ? 'audioFadeInUs' : 'audioFadeOutUs';
        const curveProp = payload.edge === 'in' ? 'audioFadeInCurve' : 'audioFadeOutCurve';
        timelineStore.updateClipProperties(payload.trackId, payload.itemId, {
          [propName]: resizeFade.value.startFadeUs,
          [curveProp]: resizeFade.value.startCurve,
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
    if (mode === 'adjacent' && adjacent) {
      limitByHandle = getTransitionAdjacentHandleLimitUs({
        edge: input.edge,
        adjacent,
      });
    }

    if (mode === 'background' || mode === 'transparent') {
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
    if (mode !== 'adjacent' || !adjacent) return null;

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

  function startResizeTransition(e: PointerEvent, payload: TimelineResizeFadePayload) {
    if (!canEditClipContent()) return;
    e.stopPropagation();
    e.preventDefault();
    resizeTransition.value = {
      trackId: payload.trackId,
      itemId: payload.itemId,
      edge: payload.edge,
      startX: e.clientX,
      startDurationUs: payload.durationUs,
    };

    clearActivePointerListeners();

    function onPointerMove(ev: PointerEvent) {
      if (!resizeTransition.value) return;
      const dx = ev.clientX - resizeTransition.value.startX;
      const sign = payload.edge === 'in' ? 1 : -1;
      const deltaPx = dx * sign;
      const deltaUs = pxToDeltaUs(deltaPx, timelineStore.timelineZoom);

      const tracks = tracksRef();
      const track = tracks.find((t) => t.id === payload.trackId);
      const item = track?.items.find((i) => i.id === payload.itemId);
      if (!item || item.kind !== 'clip') return;

      const current =
        payload.edge === 'in'
          ? (item as TimelineClipItem).transitionIn
          : (item as TimelineClipItem).transitionOut;
      if (!current) return;

      const maxUsRaw = computeMaxResizableTransitionDurationUs({
        trackId: payload.trackId,
        itemId: payload.itemId,
        edge: payload.edge,
        currentTransition: current,
      });

      const clipDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));
      const oppositeTransitionUs = Math.max(
        0,
        Math.round(
          payload.edge === 'in'
            ? ((item as TimelineClipItem).transitionOut?.durationUs ?? 0)
            : ((item as TimelineClipItem).transitionIn?.durationUs ?? 0),
        ),
      );
      const hardMaxUs = Math.max(0, clipDurationUs - oppositeTransitionUs);

      let newDurationUs = Math.min(
        Math.max(0, resizeTransition.value.startDurationUs + deltaUs),
        hardMaxUs,
      );

      if (timelineSettingsStore.clipSnapMode === 'clips') {
        const thresholdUs = Math.round(
          (timelineSettingsStore.snapThresholdPx / zoomToPxPerSecond(timelineStore.timelineZoom)) *
            1e6,
        );
        const handleSnapUs = computeTransitionHandleSnapDurationUs({
          trackId: payload.trackId,
          itemId: payload.itemId,
          edge: payload.edge,
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

      const timelineDoc = timelineStore.timelineDoc;
      const fps = timelineDoc ? timelineDoc.timebase.fps : 30;
      const frameDurationUs = 1_000_000 / fps;

      // Remove transition if duration is less than a frame
      if (newDurationUs < frameDurationUs) {
        scheduleResizeUpdate(() => {
          timelineStore.updateClipTransition(
            payload.trackId,
            payload.itemId,
            payload.edge === 'in' ? { transitionIn: null } : { transitionOut: null },
          );
        });
        return;
      }

      const transitionPatch =
        payload.edge === 'in'
          ? {
              transitionIn: { ...current, durationUs: Math.round(newDurationUs) } as ClipTransition,
            }
          : {
              transitionOut: {
                ...current,
                durationUs: Math.round(newDurationUs),
              } as ClipTransition,
            };
      scheduleResizeUpdate(() => {
        timelineStore.updateClipTransition(payload.trackId, payload.itemId, transitionPatch);
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
        const track = tracks.find((t) => t.id === payload.trackId);
        const item = track?.items.find((i) => i.id === payload.itemId);
        if (item && item.kind === 'clip') {
          const current = payload.edge === 'in' ? item.transitionIn : item.transitionOut;
          if (current) {
            const transitionPatch =
              payload.edge === 'in'
                ? {
                    transitionIn: {
                      ...current,
                      durationUs: resizeTransition.value.startDurationUs,
                    } as ClipTransition,
                  }
                : {
                    transitionOut: {
                      ...current,
                      durationUs: resizeTransition.value.startDurationUs,
                    } as ClipTransition,
                  };
            timelineStore.updateClipTransition(payload.trackId, payload.itemId, transitionPatch);
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
