import { computed, type Ref } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import { DEFAULT_TRANSITION_CURVE, DEFAULT_TRANSITION_MODE } from '~/transitions';

interface UseClipTransitionsOptions {
  clip: Ref<TimelineClipItem>;
  defaultDurationUs: Ref<number>;
  selectTransition: (payload: { trackId: string; itemId: string; edge: 'in' | 'out' }) => void;
  selectTimelineTransition: (trackId: string, itemId: string, edge: 'in' | 'out') => void;
  updateClipTransition: (
    trackId: string,
    itemId: string,
    patch: {
      transitionIn?: import('~/timeline/types').ClipTransition | null;
      transitionOut?: import('~/timeline/types').ClipTransition | null;
    },
  ) => void;
}

function getClipTransition(clip: TimelineClipItem, edge: 'in' | 'out') {
  return (edge === 'in' ? (clip as any).transitionIn : (clip as any).transitionOut) as
    | import('~/timeline/types').ClipTransition
    | null
    | undefined;
}

export function useClipTransitions(options: UseClipTransitionsOptions) {
  const transitionIn = computed(() => getClipTransition(options.clip.value, 'in') ?? null);
  const transitionOut = computed(() => getClipTransition(options.clip.value, 'out') ?? null);

  function handleTransitionUpdate(payload: {
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
    transition: import('~/timeline/types').ClipTransition | null;
  }) {
    if (payload.edge === 'in') {
      options.updateClipTransition(payload.trackId, payload.itemId, {
        transitionIn: payload.transition,
      });
      return;
    }

    options.updateClipTransition(payload.trackId, payload.itemId, {
      transitionOut: payload.transition,
    });
  }

  function selectTransitionEdge(edge: 'in' | 'out') {
    const clip = options.clip.value;
    options.selectTransition({ trackId: clip.trackId, itemId: clip.id, edge });
    options.selectTimelineTransition(clip.trackId, clip.id, edge);
  }

  function toggleTransition(edge: 'in' | 'out') {
    const clip = options.clip.value;
    const current = getClipTransition(clip, edge);

    if (current) {
      handleTransitionUpdate({ trackId: clip.trackId, itemId: clip.id, edge, transition: null });
      return;
    }

    const clipDurationUs = Math.max(0, Math.round(Number(clip.timelineRange?.durationUs ?? 0)));
    const safeDefaultDurationUs = Math.max(
      0,
      Math.round(Number(options.defaultDurationUs.value ?? 0)),
    );
    const suggestedDurationUs =
      clipDurationUs > 0 && clipDurationUs < safeDefaultDurationUs
        ? Math.round(clipDurationUs * 0.3)
        : safeDefaultDurationUs;

    const transition = {
      type: 'dissolve',
      durationUs: suggestedDurationUs,
      mode: DEFAULT_TRANSITION_MODE,
      curve: DEFAULT_TRANSITION_CURVE,
    } satisfies import('~/timeline/types').ClipTransition;

    handleTransitionUpdate({ trackId: clip.trackId, itemId: clip.id, edge, transition });
    options.selectTransition({ trackId: clip.trackId, itemId: clip.id, edge });
  }

  function updateTransitionDuration(edge: 'in' | 'out', durationSec: number) {
    const clip = options.clip.value;
    const current = getClipTransition(clip, edge);
    if (!current) return;

    handleTransitionUpdate({
      trackId: clip.trackId,
      itemId: clip.id,
      edge,
      transition: {
        ...current,
        durationUs: Math.round(durationSec * 1_000_000),
      },
    });
  }

  function updateTransitionType(edge: 'in' | 'out', type: string) {
    const clip = options.clip.value;
    const current = getClipTransition(clip, edge);
    if (!current || !type) return;

    handleTransitionUpdate({
      trackId: clip.trackId,
      itemId: clip.id,
      edge,
      transition: {
        ...current,
        type,
      },
    });
  }

  return {
    transitionIn,
    transitionOut,
    selectTransitionEdge,
    toggleTransition,
    updateTransitionDuration,
    updateTransitionType,
  };
}
