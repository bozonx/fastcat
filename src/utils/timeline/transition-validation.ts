import { TICKS_PER_SECOND } from '~/utils/time';
import type { TimelineTrack, TimelineClipItem } from '~/timeline/types';
import {
  getClipHeadTimelineHandleTicks,
  getClipTailTimelineHandleTicks,
  getNextClipForItem,
  getPrevClipForItem,
} from '~/utils/timeline/clip';
import { DEFAULT_TRANSITION_MODE } from '~/transitions';

export interface TransitionValidationError {
  key: string;
  params?: Record<string, string>;
}

export function validateTransitionIn(
  track: TimelineTrack,
  item: TimelineClipItem,
): TransitionValidationError | null {
  const tr = item.transitionIn;
  if (!tr) return null;

  const mode = tr.mode ?? DEFAULT_TRANSITION_MODE;
  if (mode === 'background' || mode === 'transparent') return null;

  const needS = (tr.durationTicks / TICKS_PER_SECOND).toFixed(2);
  const clipDurS = (item.timelineRange.durationTicks / TICKS_PER_SECOND).toFixed(2);

  if (item.timelineRange.durationTicks < tr.durationTicks) {
    return {
      key: 'fastcat.timeline.transition.errorClipTooShort',
      params: { need: needS, have: clipDurS },
    };
  }

  // Both edges consume the clip's own visible material; when their windows would
  // overlap the render only shows the nearer edge, so the other is effectively cut.
  const oppTicks = item.transitionOut?.durationTicks ?? 0;
  if (oppTicks > 0 && item.timelineRange.durationTicks < tr.durationTicks + oppTicks) {
    return {
      key: 'fastcat.timeline.transition.errorClipTooShortForBoth',
      params: {
        need: ((tr.durationTicks + oppTicks) / TICKS_PER_SECOND).toFixed(2),
        have: clipDurS,
      },
    };
  }

  if (mode === 'adjacent') {
    const prev = getPrevClipForItem(track, item);
    if (!prev) {
      return { key: 'fastcat.timeline.transition.errorNoPreviousClip' };
    }

    const prevEndTicks = prev.timelineRange.startTicks + prev.timelineRange.durationTicks;
    const gapTicks = item.timelineRange.startTicks - prevEndTicks;

    if (gapTicks !== 0) {
      return {
        key: 'fastcat.timeline.transition.errorGapBetweenClips',
        params: { gapSeconds: (gapTicks / TICKS_PER_SECOND).toFixed(2) },
      };
    }

    const prevTailHandleTicks = getClipTailTimelineHandleTicks(prev);
    if (Number.isFinite(prevTailHandleTicks) && prevTailHandleTicks < tr.durationTicks) {
      return {
        key: 'fastcat.timeline.transition.errorPrevHandleTooShort',
        params: {
          needSeconds: needS,
          haveSeconds: Math.max(0, prevTailHandleTicks / TICKS_PER_SECOND).toFixed(2),
        },
      };
    }
  }

  return null;
}

export function validateTransitionOut(
  track: TimelineTrack,
  item: TimelineClipItem,
): TransitionValidationError | null {
  const tr = item.transitionOut;
  if (!tr) return null;

  const mode = tr.mode ?? DEFAULT_TRANSITION_MODE;
  if (mode === 'background' || mode === 'transparent') return null;

  const clipDurS = (item.timelineRange.durationTicks / TICKS_PER_SECOND).toFixed(2);
  const needS = (tr.durationTicks / TICKS_PER_SECOND).toFixed(2);

  if (item.timelineRange.durationTicks < tr.durationTicks) {
    return {
      key: 'fastcat.timeline.transition.errorClipTooShort',
      params: { need: needS, have: clipDurS },
    };
  }

  // Both edges consume the clip's own visible material; when their windows would
  // overlap the render only shows the nearer edge, so the other is effectively cut.
  const oppTicks = item.transitionIn?.durationTicks ?? 0;
  if (oppTicks > 0 && item.timelineRange.durationTicks < tr.durationTicks + oppTicks) {
    return {
      key: 'fastcat.timeline.transition.errorClipTooShortForBoth',
      params: {
        need: ((tr.durationTicks + oppTicks) / TICKS_PER_SECOND).toFixed(2),
        have: clipDurS,
      },
    };
  }

  if (mode === 'adjacent') {
    const next = getNextClipForItem(track, item);
    if (!next) {
      return { key: 'fastcat.timeline.transition.errorNoNextClip' };
    }

    const clipEndTicks = item.timelineRange.startTicks + item.timelineRange.durationTicks;
    const gapTicks = next.timelineRange.startTicks - clipEndTicks;

    if (gapTicks !== 0) {
      return {
        key: 'fastcat.timeline.transition.errorGapBetweenClips',
        params: { gapSeconds: (gapTicks / TICKS_PER_SECOND).toFixed(2) },
      };
    }

    const nextHeadHandleTicks = getClipHeadTimelineHandleTicks(next);
    if (Number.isFinite(nextHeadHandleTicks) && nextHeadHandleTicks < tr.durationTicks) {
      return {
        key: 'fastcat.timeline.transition.errorNextHandleTooShort',
        params: {
          needSeconds: needS,
          haveSeconds: Math.max(0, nextHeadHandleTicks / TICKS_PER_SECOND).toFixed(2),
        },
      };
    }
  }

  return null;
}
