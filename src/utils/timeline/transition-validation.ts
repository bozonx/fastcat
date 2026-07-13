import { TICKS_PER_SECOND } from '~/utils/time';
import type { TimelineTrack, TimelineClipItem } from '~/timeline/types';
import {
  getClipHeadTimelineHandleUs,
  getClipTailTimelineHandleUs,
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

  const needS = (tr.durationUs / TICKS_PER_SECOND).toFixed(2);
  const clipDurS = (item.timelineRange.durationUs / TICKS_PER_SECOND).toFixed(2);

  if (item.timelineRange.durationUs < tr.durationUs) {
    return {
      key: 'fastcat.timeline.transition.errorClipTooShort',
      params: { need: needS, have: clipDurS },
    };
  }

  if (mode === 'adjacent') {
    const prev = getPrevClipForItem(track, item);
    if (!prev) {
      return { key: 'fastcat.timeline.transition.errorNoPreviousClip' };
    }

    const prevEndUs = prev.timelineRange.startUs + prev.timelineRange.durationUs;
    const gapUs = item.timelineRange.startUs - prevEndUs;

    if (gapUs !== 0) {
      return {
        key: 'fastcat.timeline.transition.errorGapBetweenClips',
        params: { gapSeconds: (gapUs / TICKS_PER_SECOND).toFixed(2) },
      };
    }

    const prevTailHandleUs = getClipTailTimelineHandleUs(prev);
    if (Number.isFinite(prevTailHandleUs) && prevTailHandleUs < tr.durationUs) {
      return {
        key: 'fastcat.timeline.transition.errorPrevHandleTooShort',
        params: {
          needSeconds: needS,
          haveSeconds: Math.max(0, prevTailHandleUs / TICKS_PER_SECOND).toFixed(2),
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

  const clipDurS = (item.timelineRange.durationUs / TICKS_PER_SECOND).toFixed(2);
  const needS = (tr.durationUs / TICKS_PER_SECOND).toFixed(2);

  if (item.timelineRange.durationUs < tr.durationUs) {
    return {
      key: 'fastcat.timeline.transition.errorClipTooShort',
      params: { need: needS, have: clipDurS },
    };
  }

  if (mode === 'adjacent') {
    const next = getNextClipForItem(track, item);
    if (!next) {
      return { key: 'fastcat.timeline.transition.errorNoNextClip' };
    }

    const clipEndUs = item.timelineRange.startUs + item.timelineRange.durationUs;
    const gapUs = next.timelineRange.startUs - clipEndUs;

    if (gapUs !== 0) {
      return {
        key: 'fastcat.timeline.transition.errorGapBetweenClips',
        params: { gapSeconds: (gapUs / TICKS_PER_SECOND).toFixed(2) },
      };
    }

    const nextHeadHandleUs = getClipHeadTimelineHandleUs(next);
    if (Number.isFinite(nextHeadHandleUs) && nextHeadHandleUs < tr.durationUs) {
      return {
        key: 'fastcat.timeline.transition.errorNextHandleTooShort',
        params: {
          needSeconds: needS,
          haveSeconds: Math.max(0, nextHeadHandleUs / TICKS_PER_SECOND).toFixed(2),
        },
      };
    }
  }

  return null;
}
