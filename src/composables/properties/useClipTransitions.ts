import { TICKS_PER_SECOND } from '~/utils/time';
import { computed, type Ref } from 'vue';
import type { TimelineClipItem } from '~/timeline/types';
import {
  DEFAULT_TRANSITION_CURVE,
  DEFAULT_TRANSITION_MODE,
  resolveAppliedTransitionPreset,
} from '~/transitions';

interface UseClipTransitionsOptions {
  clip: Ref<TimelineClipItem | null>;
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
  return edge === 'in' ? clip.transitionIn : clip.transitionOut;
}

export function useClipTransitions(options: UseClipTransitionsOptions) {
  const transitionIn = computed(() => {
    const clip = options.clip.value;
    return clip ? (getClipTransition(clip, 'in') ?? null) : null;
  });
  const transitionOut = computed(() => {
    const clip = options.clip.value;
    return clip ? (getClipTransition(clip, 'out') ?? null) : null;
  });

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
    if (!clip) return;
    options.selectTransition({ trackId: clip.trackId, itemId: clip.id, edge });
    options.selectTimelineTransition(clip.trackId, clip.id, edge);
  }

  function toggleTransition(edge: 'in' | 'out') {
    const clip = options.clip.value;
    if (!clip) return;
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
    if (!clip) return;
    const current = getClipTransition(clip, edge);
    if (!current) return;

    handleTransitionUpdate({
      trackId: clip.trackId,
      itemId: clip.id,
      edge,
      transition: {
        ...current,
        durationUs: Math.round(durationSec * TICKS_PER_SECOND),
      },
    });
  }

  function updateTransitionType(edge: 'in' | 'out', type: string | undefined) {
    const clip = options.clip.value;
    if (!clip) return;
    const current = getClipTransition(clip, edge);
    if (!current || !type) return;
    const appliedTransition = resolveAppliedTransitionPreset(type);

    handleTransitionUpdate({
      trackId: clip.trackId,
      itemId: clip.id,
      edge,
      transition: {
        ...current,
        type: appliedTransition.type,
        ...(appliedTransition.params ? { params: appliedTransition.params } : {}),
      },
    });
  }

  function updateTransitionCurve(
    edge: 'in' | 'out',
    curve: import('~/transitions').TransitionCurve | undefined,
  ) {
    const clip = options.clip.value;
    if (!clip || !curve) return;
    const current = getClipTransition(clip, edge);
    if (!current) return;

    // Mirror the desktop curve presets: linear drops the bezier params, the
    // eased curves seed bulge/offset so the rendered shape matches the picker.
    const params = { ...(current.params ?? {}) } as Record<string, unknown>;
    if (curve === 'linear') {
      delete params.curveBulge;
      delete params.curveOffset;
    } else {
      params.curveBulge = 0.8;
      params.curveOffset = curve === 'ease-in' ? 1.0 : curve === 'ease-out' ? 0.0 : 0.5;
    }

    handleTransitionUpdate({
      trackId: clip.trackId,
      itemId: clip.id,
      edge,
      transition: {
        ...current,
        curve,
        params,
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
    updateTransitionCurve,
  };
}
