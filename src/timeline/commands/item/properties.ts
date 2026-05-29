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
  autoAdaptClipTransitions,
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
  sanitizeTextStyle,
  clampAudioFadeUs,
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

  // Fade values are stored in timeline microseconds.
  // Clamp to the current clip duration to avoid invalid envelopes.
  if ('audioFadeInUs' in nextProps) {
    const clipDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));
    const oppFadeUs = Math.max(0, Math.round(item.audioFadeOutUs ?? 0));
    const maxUs = Math.max(0, clipDurationUs - oppFadeUs);
    const safe = clampAudioFadeUs(nextProps['audioFadeInUs'], maxUs);
    if (safe === undefined) {
      delete nextProps['audioFadeInUs'];
    } else {
      nextProps['audioFadeInUs'] = safe;
    }
  }
  if ('audioFadeOutUs' in nextProps) {
    const clipDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));
    const oppFadeUs = Math.max(0, Math.round(item.audioFadeInUs ?? 0));
    const maxUs = Math.max(0, clipDurationUs - oppFadeUs);
    const safe = clampAudioFadeUs(nextProps['audioFadeOutUs'], maxUs);
    if (safe === undefined) {
      delete nextProps['audioFadeOutUs'];
    } else {
      nextProps['audioFadeOutUs'] = safe;
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
      const normalized = autoAdaptClipTransitions(
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
    durationUs: number;
    mode: TransitionMode;
    curve: TransitionCurve;
    params?: Record<string, unknown>;
    isOverridden?: boolean;
  } | null {
    if (!raw) return null;
    const rawObj = raw as Record<string, unknown>;
    const type = typeof rawObj.type === 'string' ? rawObj.type : '';
    const durationUs = Number(rawObj.durationUs);
    if (!type) return null;
    if (!Number.isFinite(durationUs) || durationUs <= 0) {
      return {
        type,
        durationUs: 0,
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
      durationUs: Math.max(0, Math.round(durationUs)),
      mode: normalizeTransitionMode(rawObj.mode),
      curve: normalizeTransitionCurve(rawObj.curve),
      params: normalizeTransitionParams(type, rawObj.params as Record<string, unknown> | undefined),
      isOverridden: rawObj.isOverridden as boolean | undefined,
    };
  }

  const patch: Record<string, unknown> = {};

  const clipDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

  // Existing transitions on the *other* edge cap how long this edge can grow.
  // Without this, setting a long fade-in on a short clip with an existing
  // fade-out drops the user's value through the global normalization pass and
  // also shrinks the unrelated opposite edge — surprising behaviour.
  const existingInUs = Math.max(0, Math.round(item.transitionIn?.durationUs ?? 0));
  const existingOutUs = Math.max(0, Math.round(item.transitionOut?.durationUs ?? 0));

  function clampTransitionUs(input: {
    edge: 'in' | 'out';
    requested: {
      type: string;
      durationUs: number;
      mode: TransitionMode;
      curve: TransitionCurve;
      params?: Record<string, unknown>;
      isOverridden?: boolean;
    };
  }): {
    type: string;
    durationUs: number;
    mode: TransitionMode;
    curve: TransitionCurve;
    params?: Record<string, unknown>;
    isOverridden?: boolean;
  } {
    const oppositeUs = input.edge === 'in' ? existingOutUs : existingInUs;
    const maxUs = Math.max(0, clipDurationUs - oppositeUs);
    return {
      ...input.requested,
      durationUs: Math.min(Math.max(0, Math.round(input.requested.durationUs)), maxUs),
    };
  }

  let requestedIn = 'transitionIn' in cmd ? coerceTransition(cmd.transitionIn) : undefined;
  if (requestedIn) {
    requestedIn = clampTransitionUs({
      edge: 'in',
      requested: requestedIn,
    });
  }

  let requestedOut = 'transitionOut' in cmd ? coerceTransition(cmd.transitionOut) : undefined;
  if (requestedOut) {
    requestedOut = clampTransitionUs({
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
    nextItemsRaw.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
    const nextItems = autoAdaptClipTransitions(
      normalizeGaps(doc, t.id, nextItemsRaw, { quantizeToFrames: false }),
    );
    return { ...t, items: nextItems };
  });

  return { next: { ...doc, tracks: nextTracks } };
}
