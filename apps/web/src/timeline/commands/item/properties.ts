import type { TimelineDocument, TimelineTrackItem, TimelineClipItem } from '../../types';
import type {
  RenameItemCommand,
  UpdateClipPropertiesCommand,
  UpdateClipTransitionCommand,
  TimelineCommandResult,
} from '../../commands';
import {
  getTrackById,
  getDocFps,
  normalizeGaps,
  autoAdaptClipEdgeDurations,
  assertClipNotLocked,
} from '../utils';
import { normalizeBalance, normalizeGain } from '~/utils/audio/envelope';
import {
  normalizeTransitionCurve,
  normalizeTransitionMode,
  normalizeTransitionParams,
} from '~/transitions';
import type { TransitionCurve, TransitionMode } from '~/transitions';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';
import {
  sanitizeBlendMode,
  sanitizeSourceOrientation,
  sanitizeTransform,
  sanitizeAnimations,
  sanitizeTextStyle,
  clampAudioFadeTicks,
} from './clip-property-sanitizers';
import { applyClipSpeedChange } from './clip-speed';

export function renameItem(doc: TimelineDocument, cmd: RenameItemCommand): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || item.kind !== 'clip') throw new Error('Item not found or not a clip');
  if (item.name === cmd.name) return { next: doc };

  const nextTracks = doc.tracks.map((t) => {
    if (t.id === track.id) {
      return {
        ...t,
        items: t.items.map((it) =>
          it.id === cmd.itemId && it.kind === 'clip' ? { ...it, name: cmd.name } : it,
        ),
      };
    }
    return t;
  });
  return { next: { ...doc, tracks: nextTracks } };
}

export function updateClipProperties(
  doc: TimelineDocument,
  cmd: UpdateClipPropertiesCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || item.kind !== 'clip') return { next: doc };

  const nextProps: Record<string, unknown> = { ...cmd.properties };
  const fps = getDocFps(doc);

  // If the clip is locked, allow only `locked` itself to change (so unlocking
  // remains possible) and otherwise reject the edit. Geometry/audio/transform
  // changes on a locked clip are a UX bug we used to tolerate silently.
  if (item.locked) {
    const onlyTogglingLock =
      Object.keys(nextProps).length === 1 &&
      Object.prototype.hasOwnProperty.call(nextProps, 'locked');
    if (!onlyTogglingLock) {
      assertClipNotLocked(item, 'updateProperties');
    }
  }

  // Speed changes recompute the clip's duration and may ripple-shift downstream
  // clips. When a ripple happens the helper builds the final document itself, so
  // we must return it directly; otherwise it mutates `nextProps` and we fall
  // through to apply the remaining properties.
  const speedResult = applyClipSpeedChange({ doc, track, item, fps, nextProps });
  if (speedResult) return speedResult;

  if ('backgroundColor' in nextProps) {
    if (item.clipType !== 'background') {
      delete nextProps.backgroundColor;
    } else {
      nextProps.backgroundColor = sanitizeTimelineColor(nextProps.backgroundColor, '#000000');
    }
  }

  if (item.clipType === 'shape') {
    if ('fillColor' in nextProps) {
      nextProps['fillColor'] =
        typeof nextProps.fillColor === 'string' ? nextProps.fillColor : undefined;
    }
    if ('strokeColor' in nextProps) {
      nextProps['strokeColor'] =
        typeof nextProps.strokeColor === 'string' ? nextProps.strokeColor : undefined;
    }
    if ('strokeWidth' in nextProps) {
      nextProps['strokeWidth'] =
        typeof nextProps.strokeWidth === 'number' ? nextProps.strokeWidth : undefined;
    }
  }

  if ('snapToPixelGrid' in nextProps) {
    if (item.clipType !== 'text' && item.clipType !== 'shape') {
      delete nextProps['snapToPixelGrid'];
    } else {
      nextProps['snapToPixelGrid'] =
        typeof nextProps['snapToPixelGrid'] === 'boolean'
          ? nextProps['snapToPixelGrid']
          : undefined;
    }
  }

  if ('text' in nextProps) {
    if (item.clipType !== 'text') {
      delete nextProps['text'];
    } else {
      const raw = nextProps['text'];
      const safe = typeof raw === 'string' ? raw : '';
      nextProps['text'] = safe;
    }
  }

  if ('style' in nextProps) {
    if (item.clipType !== 'text') {
      delete nextProps['style'];
    } else {
      const safeStyle = sanitizeTextStyle(nextProps['style']);
      if (safeStyle === undefined) {
        delete nextProps['style'];
      } else {
        nextProps['style'] = safeStyle;
      }
    }
  }

  if ('transform' in nextProps) {
    const safe = sanitizeTransform(nextProps['transform']);
    if (safe === undefined) {
      delete nextProps.transform;
    } else {
      nextProps.transform = safe;
    }
  }

  if ('animations' in nextProps) {
    // `null`/empty clears all keyframes; otherwise normalize the tracks.
    nextProps['animations'] = sanitizeAnimations(nextProps['animations']) ?? undefined;
  }

  if ('opacity' in nextProps) {
    const raw = nextProps['opacity'];
    const safe =
      typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : undefined;
    if (safe === undefined) {
      delete nextProps['opacity'];
    } else {
      nextProps['opacity'] = safe;
    }
  }

  if ('blendMode' in nextProps) {
    const safe = sanitizeBlendMode(nextProps['blendMode']);
    if (safe === undefined) {
      delete nextProps['blendMode'];
    } else {
      nextProps['blendMode'] = safe;
    }
  }

  if ('sourceOrientation' in nextProps) {
    const safe = sanitizeSourceOrientation(nextProps['sourceOrientation']);
    if (safe === undefined) {
      delete nextProps['sourceOrientation'];
    } else {
      nextProps['sourceOrientation'] = safe;
    }
  }

  if ('audioGain' in nextProps) {
    const raw = nextProps['audioGain'];
    const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    const gain = v === undefined ? undefined : normalizeGain(v, 1);
    if (gain === undefined) {
      delete nextProps['audioGain'];
    } else {
      nextProps['audioGain'] = gain;
    }
  }

  if ('audioBalance' in nextProps) {
    const raw = nextProps['audioBalance'];
    const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    const balance = v === undefined ? undefined : normalizeBalance(v, 0);
    if (balance === undefined) {
      delete nextProps['audioBalance'];
    } else {
      nextProps['audioBalance'] = balance;
    }
  }

  // Fade values are stored in timeline ticks.
  // Clamp to the current clip duration to avoid invalid envelopes.
  if ('audioFadeInTicks' in nextProps) {
    const clipDurationTicks = Math.max(0, Math.round(item.timelineRange.durationTicks));
    const oppFadeTicks = Math.max(0, Math.round(item.audioFadeOutTicks ?? 0));
    const maxTicks = Math.max(0, clipDurationTicks - oppFadeTicks);
    const safe = clampAudioFadeTicks(nextProps['audioFadeInTicks'], maxTicks);
    if (safe === undefined) {
      delete nextProps['audioFadeInTicks'];
    } else {
      nextProps['audioFadeInTicks'] = safe;
    }
  }
  if ('audioFadeOutTicks' in nextProps) {
    const clipDurationTicks = Math.max(0, Math.round(item.timelineRange.durationTicks));
    const oppFadeTicks = Math.max(0, Math.round(item.audioFadeInTicks ?? 0));
    const maxTicks = Math.max(0, clipDurationTicks - oppFadeTicks);
    const safe = clampAudioFadeTicks(nextProps['audioFadeOutTicks'], maxTicks);
    if (safe === undefined) {
      delete nextProps['audioFadeOutTicks'];
    } else {
      nextProps['audioFadeOutTicks'] = safe;
    }
  }
  if ('audioFadeInCurve' in nextProps) {
    const raw = nextProps['audioFadeInCurve'];
    nextProps['audioFadeInCurve'] = raw === 'logarithmic' ? 'logarithmic' : 'linear';
  }
  if ('audioFadeOutCurve' in nextProps) {
    const raw = nextProps['audioFadeOutCurve'];
    nextProps['audioFadeOutCurve'] = raw === 'logarithmic' ? 'logarithmic' : 'linear';
  }

  const nextTracks = doc.tracks.map((t) => {
    if (t.id === track.id) {
      const updatedItems = t.items.map((it) =>
        it.id === cmd.itemId && it.kind === 'clip'
          ? ({ ...it, ...nextProps } as TimelineClipItem)
          : it,
      );
      const normalized = autoAdaptClipEdgeDurations(
        normalizeGaps(doc, t.id, updatedItems, { quantizeToFrames: false }),
      );
      return { ...t, items: normalized };
    }
    return t;
  });

  return { next: { ...doc, tracks: nextTracks } };
}

export function updateClipTransition(
  doc: TimelineDocument,
  cmd: UpdateClipTransitionCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || item.kind !== 'clip') return { next: doc };

  function coerceTransition(raw: unknown): {
    type: string;
    durationTicks: number;
    mode: TransitionMode;
    curve: TransitionCurve;
    params?: Record<string, unknown>;
    isOverridden?: boolean;
  } | null {
    if (!raw) return null;
    const rawObj = raw as Record<string, unknown>;
    const type = typeof rawObj.type === 'string' ? rawObj.type : '';
    const durationTicks = Number(rawObj.durationTicks);
    if (!type) return null;
    if (!Number.isFinite(durationTicks) || durationTicks <= 0) {
      return {
        type,
        durationTicks: 0,
        mode: normalizeTransitionMode(rawObj.mode),
        curve: normalizeTransitionCurve(rawObj.curve),
        params: normalizeTransitionParams(
          type,
          rawObj.params as Record<string, unknown> | undefined,
        ),
        isOverridden: rawObj.isOverridden as boolean | undefined,
      };
    }
    return {
      type,
      durationTicks: Math.max(0, Math.round(durationTicks)),
      mode: normalizeTransitionMode(rawObj.mode),
      curve: normalizeTransitionCurve(rawObj.curve),
      params: normalizeTransitionParams(type, rawObj.params as Record<string, unknown> | undefined),
      isOverridden: rawObj.isOverridden as boolean | undefined,
    };
  }

  const patch: Record<string, unknown> = {};

  const clipDurationTicks = Math.max(0, Math.round(item.timelineRange.durationTicks));

  // Existing transitions on the *other* edge cap how long this edge can grow.
  // Without this, setting a long fade-in on a short clip with an existing
  // fade-out drops the user's value through the global normalization pass and
  // also shrinks the unrelated opposite edge — surprising behaviour.
  const existingInTicks = Math.max(0, Math.round(item.transitionIn?.durationTicks ?? 0));
  const existingOutTicks = Math.max(0, Math.round(item.transitionOut?.durationTicks ?? 0));

  function clampTransitionTicks(input: {
    edge: 'in' | 'out';
    requested: {
      type: string;
      durationTicks: number;
      mode: TransitionMode;
      curve: TransitionCurve;
      params?: Record<string, unknown>;
      isOverridden?: boolean;
    };
  }): {
    type: string;
    durationTicks: number;
    mode: TransitionMode;
    curve: TransitionCurve;
    params?: Record<string, unknown>;
    isOverridden?: boolean;
  } {
    const oppositeTicks = input.edge === 'in' ? existingOutTicks : existingInTicks;
    const maxTicks = Math.max(0, clipDurationTicks - oppositeTicks);
    return {
      ...input.requested,
      durationTicks: Math.min(Math.max(0, Math.round(input.requested.durationTicks)), maxTicks),
    };
  }

  let requestedIn = 'transitionIn' in cmd ? coerceTransition(cmd.transitionIn) : undefined;
  if (requestedIn) {
    requestedIn = clampTransitionTicks({
      edge: 'in',
      requested: requestedIn,
    });
  }

  let requestedOut = 'transitionOut' in cmd ? coerceTransition(cmd.transitionOut) : undefined;
  if (requestedOut) {
    requestedOut = clampTransitionTicks({
      edge: 'out',
      requested: requestedOut,
    });
  }

  if ('transitionIn' in cmd) {
    patch.transitionIn = requestedIn ?? undefined;
  }
  if ('transitionOut' in cmd) {
    patch.transitionOut = requestedOut ?? undefined;
  }

  const nextTracks = doc.tracks.map((t) => {
    if (t.id !== track.id) return t;
    const nextItemsRaw = t.items.map((it) =>
      it.id === item.id ? ({ ...it, ...patch } as TimelineTrackItem) : it,
    );
    nextItemsRaw.sort((a, b) => a.timelineRange.startTicks - b.timelineRange.startTicks);
    const nextItems = autoAdaptClipEdgeDurations(
      normalizeGaps(doc, t.id, nextItemsRaw, { quantizeToFrames: false }),
    );
    return { ...t, items: nextItems };
  });

  return { next: { ...doc, tracks: nextTracks } };
}
