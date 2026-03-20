import { onBeforeUnmount, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { pxToDeltaUs, pickBestSnapCandidateUs, zoomToPxPerSecond } from '~/utils/timeline/geometry';
import type {
  TimelineTrack,
  TimelineClipItem,
  ClipTransition,
  TimelineResizeFadePayload,
  TimelineResizeVolumePayload,
} from '~/timeline/types';
import { DEFAULT_TRANSITION_MODE } from '~/transitions';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelinePointerSession } from '~/composables/timeline/useTimelinePointerSession';

interface ClipResizeFields {
  audioFadeInUs?: number;
  audioFadeOutUs?: number;
  sourceDurationUs?: number;
  transitionIn?: ClipTransition | null;
  transitionOut?: ClipTransition | null;
}

export function useTimelineItemResize(tracksRef: () => TimelineTrack[]) {
  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();
  const timelineSettingsStore = useTimelineSettingsStore();
  const workspaceStore = useWorkspaceStore();
  const { bindSession, clearSession, scheduleUpdate } = useTimelinePointerSession();

  function getClipResizeFields(item: TimelineClipItem): ClipResizeFields {
    return item as TimelineClipItem & ClipResizeFields;
  }

  function canEditClipContent(): boolean {
    return (
      projectStore.currentView === 'cut' ||
      projectStore.currentView === 'files' ||
      projectStore.currentView === 'sound'
    );
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

    clearSession();

    function onPointerMove(ev: PointerEvent) {
      if (!resizeVolume.value) return;
      const dy = ev.clientY - resizeVolume.value.startY;
      const deltaVol = -(dy / resizeVolume.value.trackHeight) * 4;
      let newVol = resizeVolume.value.startGain + deltaVol;
      newVol = Math.max(0, Math.min(4, newVol));

      scheduleUpdate(() => {
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
      clearSession();
    }

    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === 'Escape' && resizeVolume.value) {
        timelineStore.updateClipProperties(payload.trackId, payload.itemId, {
          audioGain: resizeVolume.value.startGain,
        });
        resizeVolume.value = null;
        clearSession();
      }
    }

    bindSession({
      onPointerMove,
      onPointerUp,
      onKeyDown,
    });
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

    clearSession();

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
      const clipFields = getClipResizeFields(item);
      const oppFadeUs = Math.max(
        0,
        Math.round(
          payload.edge === 'in'
            ? (clipFields.audioFadeOutUs ?? 0)
            : (clipFields.audioFadeInUs ?? 0),
        ),
      );
      const maxUs = Math.max(0, clipDurationUs - oppFadeUs);
      let newFadeUs = resizeFade.value.startFadeUs + deltaUs;
      newFadeUs = Math.max(0, Math.min(maxUs, newFadeUs));

      if (timelineSettingsStore.clipSnapMode === 'clips') {
        const thresholdUs = Math.round(
          (timelineSettingsStore.snapThresholdPx / zoomToPxPerSecond(timelineStore.timelineZoom)) *
            1e6,
        );

        const edgeUs =
          payload.edge === 'in'
            ? item.timelineRange.startUs + newFadeUs
            : item.timelineRange.startUs + item.timelineRange.durationUs - newFadeUs;

        const targets = [];
        if (workspaceStore.userSettings.timeline.snapping.playhead) {
          targets.push(timelineStore.currentTime);
        }

        const snap = pickBestSnapCandidateUs({
          rawUs: edgeUs,
          thresholdUs,
          targetsUs: targets,
        });

        if (snap.distUs < thresholdUs) {
          if (payload.edge === 'in') {
            newFadeUs = Math.max(0, snap.snappedUs - item.timelineRange.startUs);
          } else {
            newFadeUs = Math.max(
              0,
              item.timelineRange.startUs + item.timelineRange.durationUs - snap.snappedUs,
            );
          }
          newFadeUs = Math.min(maxUs, newFadeUs);
        }
      }

      const propName = payload.edge === 'in' ? 'audioFadeInUs' : 'audioFadeOutUs';
      const nextCurve = isLayer1Active(ev, workspaceStore.userSettings)
        ? resizeFade.value.startCurve === 'logarithmic'
          ? 'linear'
          : 'logarithmic'
        : resizeFade.value.startCurve;
      const curveChanged = nextCurve !== resizeFade.value.activeCurve;
      const curveProp = payload.edge === 'in' ? 'audioFadeInCurve' : 'audioFadeOutCurve';

      resizeFade.value.activeCurve = nextCurve;
      const nextFadeUs = Math.round(newFadeUs);
      scheduleUpdate(() => {
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
      clearSession();
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
        clearSession();
      }
    }

    bindSession({
      onPointerMove,
      onPointerUp,
      onKeyDown,
    });
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
      const prevFields = getClipResizeFields(prev);
      const prevSourceEnd = (prev.sourceRange?.startUs ?? 0) + (prev.sourceRange?.durationUs ?? 0);
      const prevMaxEnd =
        (prev.clipType === 'media' || prev.clipType === 'timeline') && !prev.isImage
          ? (prevFields.sourceDurationUs ?? prevSourceEnd)
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
    const clipFields = getClipResizeFields(clip);

    const clipDuration = clip.timelineRange.durationUs;
    const oppTransitionUs =
      input.edge === 'in'
        ? (clipFields.transitionOut?.durationUs ?? 0)
        : (clipFields.transitionIn?.durationUs ?? 0);
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
            ? (clipFields.sourceDurationUs ?? clipSourceEnd)
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

    clearSession();

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

        const edgeUs =
          payload.edge === 'in'
            ? item.timelineRange.startUs + newDurationUs
            : item.timelineRange.startUs + item.timelineRange.durationUs - newDurationUs;

        const targets = [];
        if (workspaceStore.userSettings.timeline.snapping.playhead) {
          targets.push(timelineStore.currentTime);
        }

        const handleSnapUs = computeTransitionHandleSnapDurationUs({
          trackId: payload.trackId,
          itemId: payload.itemId,
          edge: payload.edge,
          currentTransition: current,
          rawDurationUs: newDurationUs,
        });

        if (handleSnapUs !== null) {
          targets.push(
            payload.edge === 'in'
              ? item.timelineRange.startUs + handleSnapUs
              : item.timelineRange.startUs + item.timelineRange.durationUs - handleSnapUs,
          );
        }

        const snap = pickBestSnapCandidateUs({
          rawUs: edgeUs,
          thresholdUs,
          targetsUs: targets,
        });

        if (snap.distUs < thresholdUs) {
          if (payload.edge === 'in') {
            newDurationUs = Math.max(0, snap.snappedUs - item.timelineRange.startUs);
          } else {
            newDurationUs = Math.max(
              0,
              item.timelineRange.startUs + item.timelineRange.durationUs - snap.snappedUs,
            );
          }
          newDurationUs = Math.min(hardMaxUs, newDurationUs);
        }
      }

      if (maxUsRaw <= 0 && newDurationUs <= 0) return;

      const timelineDoc = timelineStore.timelineDoc;
      const fps = timelineDoc ? timelineDoc.timebase.fps : 30;
      const frameDurationUs = 1_000_000 / fps;

      // Remove transition if duration is less than a frame
      if (newDurationUs < frameDurationUs) {
        scheduleUpdate(() => {
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
      scheduleUpdate(() => {
        timelineStore.updateClipTransition(payload.trackId, payload.itemId, transitionPatch);
      });
    }

    function onPointerUp() {
      if (resizeTransition.value) {
        timelineStore.requestTimelineSave({ immediate: true });
      }
      resizeTransition.value = null;
      clearSession();
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
        clearSession();
      }
    }

    bindSession({
      onPointerMove,
      onPointerUp,
      onKeyDown,
    });
  }

  onBeforeUnmount(() => {
    clearSession();
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
