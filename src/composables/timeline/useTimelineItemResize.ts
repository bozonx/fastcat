import { ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { pxToDeltaUs } from './useTimelineInteraction';
import type { TimelineTrack, TimelineClipItem, ClipTransition } from '~/timeline/types';

export function useTimelineItemResize(tracksRef: () => TimelineTrack[]) {
  const timelineStore = useTimelineStore();

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
    e: MouseEvent,
    trackId: string,
    itemId: string,
    currentVolume: number,
    clipHeight: number,
  ) {
    e.stopPropagation();
    e.preventDefault();
    resizeVolume.value = {
      trackId,
      itemId,
      startY: e.clientY,
      startGain: currentVolume,
      trackHeight: clipHeight,
    };

    function onMouseMove(ev: MouseEvent) {
      if (!resizeVolume.value) return;
      const dy = ev.clientY - resizeVolume.value.startY;
      const deltaVol = -(dy / resizeVolume.value.trackHeight) * 2;
      let newVol = resizeVolume.value.startGain + deltaVol;
      newVol = Math.max(0, Math.min(2, newVol));

      timelineStore.updateClipProperties(trackId, itemId, {
        audioGain: newVol,
      });
    }

    function onMouseUp() {
      if (resizeVolume.value) {
        timelineStore.requestTimelineSave({ immediate: true });
      }
      resizeVolume.value = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function startResizeFade(
    e: MouseEvent,
    trackId: string,
    itemId: string,
    edge: 'in' | 'out',
    currentFadeUs: number,
  ) {
    e.stopPropagation();
    e.preventDefault();
    resizeFade.value = {
      trackId,
      itemId,
      edge,
      startX: e.clientX,
      startFadeUs: currentFadeUs,
    };

    function onMouseMove(ev: MouseEvent) {
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

    function onMouseUp() {
      if (resizeFade.value) {
        timelineStore.requestTimelineSave({ immediate: true });
      }
      resizeFade.value = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
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

    const mode = input.currentTransition.mode ?? 'blend';
    if (mode === 'blend' && adjacent) {
      if (input.edge === 'in') {
        const prev = adjacent;
        const prevSourceEnd = (prev.sourceRange?.startUs ?? 0) + (prev.sourceRange?.durationUs ?? 0);
        const prevMaxEnd =
          prev.clipType === 'media' && !prev.isImage
            ? ((prev as any).sourceDurationUs ?? prevSourceEnd)
            : Number.POSITIVE_INFINITY;
        const prevTailHandleUs = Number.isFinite(prevMaxEnd)
          ? Math.max(0, Math.round(Number(prevMaxEnd)) - Math.round(prevSourceEnd))
          : Number.POSITIVE_INFINITY;
        limitByHandle = Math.max(0, prevTailHandleUs + input.currentTransition.durationUs);
      } else {
        const curr = clip;
        const currSourceEnd = (curr.sourceRange?.startUs ?? 0) + (curr.sourceRange?.durationUs ?? 0);
        const currMaxEnd =
          curr.clipType === 'media' && !curr.isImage
            ? ((curr as any).sourceDurationUs ?? currSourceEnd)
            : Number.POSITIVE_INFINITY;
        const currTailHandleUs = Number.isFinite(currMaxEnd)
          ? Math.max(0, Math.round(Number(currMaxEnd)) - Math.round(currSourceEnd))
          : Number.POSITIVE_INFINITY;
        limitByHandle = Math.max(0, currTailHandleUs + input.currentTransition.durationUs);
      }
    }

    return Math.min(maxWithinClip, limitByHandle);
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

      if (maxUsRaw <= 0) return;
      const maxUs = Math.max(minUs, maxUsRaw);

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

  return {
    resizeTransition,
    resizeFade,
    resizeVolume,
    startResizeVolume,
    startResizeFade,
    startResizeTransition,
  };
}
