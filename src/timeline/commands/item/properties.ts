import type {
  TimelineDocument,
  TimelineTrackItem,
  TimelineClipItem,
  TimelineBlendMode,
  ClipTransform,
  ClipAnchorPreset,
} from '../../types';
import type {
  RenameItemCommand,
  UpdateClipPropertiesCommand,
  UpdateClipTransitionCommand,
  TimelineCommandResult,
} from '../../commands';
import {
  getTrackById,
  getDocFps,
  quantizeTimeUsToFrames,
  assertNoOverlap,
  assertClipNotLocked,
  normalizeGaps,
  findClipById,
  updateLinkedLockedAudio,
  autoAdaptClipTransitions,
} from '../utils';
import { normalizeBalance, normalizeGain } from '~/utils/audio/envelope';
import {
  normalizeTransitionCurve,
  normalizeTransitionMode,
  normalizeTransitionParams,
} from '~/transitions';
import type { TransitionCurve, TransitionMode } from '~/transitions';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';

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

  function clampNumber(value: unknown, min: number, max: number): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    return Math.max(min, Math.min(max, n));
  }

  function sanitizeBlendMode(value: unknown): TimelineBlendMode | undefined {
    return value === 'add' ||
      value === 'multiply' ||
      value === 'screen' ||
      value === 'darken' ||
      value === 'lighten' ||
      value === 'normal'
      ? value
      : undefined;
  }

  function clampAudioFadeUs(value: unknown, maxUs: number): number | undefined {
    if (value === undefined) return undefined;
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
    return clampNumber(n, 0, Math.max(0, Math.round(maxUs)));
  }

  function sanitizeTransform(raw: unknown): ClipTransform | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const rawRecord = raw as Record<string, unknown>;

    const scaleRaw = rawRecord.scale;
    const scale =
      scaleRaw && typeof scaleRaw === 'object'
        ? {
            x: clampNumber(scaleRaw.x, -1000, 1000),
            y: clampNumber(scaleRaw.y, -1000, 1000),
            linked: scaleRaw.linked !== undefined ? Boolean(scaleRaw.linked) : undefined,
          }
        : undefined;

    const rotationDegRaw = rawRecord.rotationDeg;
    const rotationDeg =
      typeof rotationDegRaw === 'number' && Number.isFinite(rotationDegRaw)
        ? Math.max(-36000, Math.min(36000, rotationDegRaw))
        : undefined;

    const positionRaw = rawRecord.position;
    const position =
      positionRaw && typeof positionRaw === 'object'
        ? {
            x: clampNumber(positionRaw.x, -1_000_000, 1_000_000),
            y: clampNumber(positionRaw.y, -1_000_000, 1_000_000),
          }
        : undefined;

    const anchorRaw = rawRecord.anchor;
    const preset = anchorRaw && typeof anchorRaw === 'object' ? String(anchorRaw.preset ?? '') : '';
    const safePreset =
      preset === 'center' ||
      preset === 'topLeft' ||
      preset === 'topRight' ||
      preset === 'bottomLeft' ||
      preset === 'bottomRight' ||
      preset === 'custom'
        ? (preset as ClipAnchorPreset)
        : undefined;
    const anchor =
      safePreset !== undefined
        ? {
            preset: safePreset,
            x: safePreset === 'custom' ? clampNumber(anchorRaw.x, -10, 10) : undefined,
            y: safePreset === 'custom' ? clampNumber(anchorRaw.y, -10, 10) : undefined,
          }
        : undefined;

    const cropRaw = rawRecord.crop;
    const crop =
      cropRaw && typeof cropRaw === 'object'
        ? {
            top: clampNumber(cropRaw.top ?? 0, 0, 100),
            bottom: clampNumber(cropRaw.bottom ?? 0, 0, 100),
            left: clampNumber(cropRaw.left ?? 0, 0, 100),
            right: clampNumber(cropRaw.right ?? 0, 0, 100),
          }
        : undefined;

    if (!scale && rotationDeg === undefined && !position && !anchor && !crop) return undefined;
    return {
      scale,
      rotationDeg,
      position,
      anchor,
      crop,
    };
  }

  if ('speed' in nextProps) {
    const raw = nextProps['speed'];
    const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    const speed = v === undefined ? undefined : Math.max(-10, Math.min(10, v));
    if (speed === 0) {
      throw new Error('Speed cannot be 0');
    }
    if (speed === undefined) {
      delete nextProps.speed;
    } else {
      nextProps.speed = speed;
      const nextDurationUsRaw = Math.round(item.sourceRange.durationUs / Math.abs(speed));
      const nextDurationUs = Math.max(0, quantizeTimeUsToFrames(nextDurationUsRaw, fps, 'round'));
      const startUs = item.timelineRange.startUs;
      const prevDurationUs = Math.max(0, item.timelineRange.durationUs);

      const shouldTryRipple = nextDurationUs !== prevDurationUs;
      if (shouldTryRipple) {
        try {
          if (nextDurationUs > prevDurationUs) {
            assertNoOverlap(track, item.id, startUs, nextDurationUs);
          }
          nextProps.timelineRange = { ...item.timelineRange, durationUs: nextDurationUs };
        } catch {
          // Exception means overlap occurred (or we want to explicitly ripple shift)
          const clips = track.items
            .filter((it): it is TimelineClipItem => it.kind === 'clip')
            .map((c) => ({ ...c, timelineRange: { ...c.timelineRange } }));
          clips.sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

          const movedVideoClipIds: string[] = [];
          const nextClips = clips.map((c) => {
            if (c.id !== item.id) return c;
            return {
              ...c,
              speed,
              timelineRange: { ...c.timelineRange, durationUs: nextDurationUs },
            };
          });

          // Calculate how much the clips after this one should move
          const deltaUs = nextDurationUs - prevDurationUs;
          let foundCurrent = false;

          for (let i = 0; i < nextClips.length; i++) {
            const curr = nextClips[i];
            if (!curr) continue;

            if (curr.id === item.id) {
              foundCurrent = true;
              continue;
            }

            if (foundCurrent) {
              // Ripple only shifts unlocked downstream clips. Stop the ripple
              // when we hit a locked clip — silently shoving past it would lose
              // the lock invariant — but still throw an overlap error if the
              // new geometry would collide with the locked clip.
              if (curr.locked) {
                const lockedStartUs = curr.timelineRange.startUs;
                const lockedEndUs = lockedStartUs + curr.timelineRange.durationUs;
                const rippledEndOfCurrent = nextClips
                  .slice(0, i)
                  .reduce(
                    (max, c) => Math.max(max, c.timelineRange.startUs + c.timelineRange.durationUs),
                    0,
                  );
                if (rippledEndOfCurrent > lockedStartUs + 1) {
                  throw new Error('Item overlaps with another item');
                }
                break;
              }

              const newStartUs = Math.max(0, curr.timelineRange.startUs + deltaUs);
              const qStartUs = quantizeTimeUsToFrames(newStartUs, fps, 'round');
              if (qStartUs !== curr.timelineRange.startUs) {
                nextClips[i] = {
                  ...curr,
                  timelineRange: { ...curr.timelineRange, startUs: qStartUs },
                };
                if (track.kind === 'video') {
                  movedVideoClipIds.push(curr.id);
                }
              }
            }
          }

          // Cross-check rippled layout for residual overlaps; rounding can put
          // two clips on the same frame even when delta math is exact.
          for (let i = 1; i < nextClips.length; i++) {
            const prev = nextClips[i - 1]!;
            const cur = nextClips[i]!;
            const prevEnd = prev.timelineRange.startUs + prev.timelineRange.durationUs;
            if (cur.timelineRange.startUs + 1 < prevEnd) {
              throw new Error('Item overlaps with another item');
            }
          }

          let nextTracksLocal = doc.tracks.map((t) =>
            t.id === track.id
              ? { ...t, items: normalizeGaps(doc, t.id, nextClips, { quantizeToFrames: true }) }
              : t,
          );

          for (const movedId of movedVideoClipIds) {
            const moved = nextClips.find((c) => c.id === movedId);
            if (!moved) continue;
            nextTracksLocal = updateLinkedLockedAudio(
              { ...doc, tracks: nextTracksLocal },
              movedId,
              (audio) => ({
                ...audio,
                timelineRange: { ...audio.timelineRange, startUs: moved.timelineRange.startUs },
              }),
            );
          }

          const updatedClip = nextClips.find((c) => c.id === item.id);
          if (updatedClip && track.kind === 'video' && updatedClip.clipType === 'media') {
            const startDeltaUs = updatedClip.timelineRange.startUs - item.timelineRange.startUs;
            const sourceStartDeltaUs = updatedClip.sourceRange.startUs - item.sourceRange.startUs;
            const newTimelineDurationUs = updatedClip.timelineRange.durationUs;
            nextTracksLocal = updateLinkedLockedAudio(
              { ...doc, tracks: nextTracksLocal },
              updatedClip.id,
              (a) => {
                const audioSpeed =
                  typeof a.speed === 'number' && Number.isFinite(a.speed) ? a.speed : 1;
                const audioAbsSpeed = Math.max(0.0001, Math.abs(audioSpeed));
                const audioSourceLimit = Math.max(0, Math.round(Number(a.sourceDurationUs ?? 0)));
                const nextAudioSourceStartUs = Math.max(
                  0,
                  Math.round(a.sourceRange.startUs + sourceStartDeltaUs),
                );
                const requestedAudioSourceDurationUs = Math.max(
                  0,
                  Math.round(newTimelineDurationUs * audioAbsSpeed),
                );
                const audioSourceDurationUs =
                  audioSourceLimit > 0
                    ? Math.min(
                        requestedAudioSourceDurationUs,
                        Math.max(0, audioSourceLimit - nextAudioSourceStartUs),
                      )
                    : requestedAudioSourceDurationUs;
                return {
                  ...a,
                  timelineRange: {
                    ...a.timelineRange,
                    startUs: Math.max(0, a.timelineRange.startUs + startDeltaUs),
                    durationUs: newTimelineDurationUs,
                  },
                  sourceRange: {
                    ...a.sourceRange,
                    startUs: nextAudioSourceStartUs,
                    durationUs: audioSourceDurationUs,
                  },
                  // Keep audio's own sourceDurationUs and speed — they may come
                  // from a different file (extracted audio) and overriding them
                  // would corrupt the clip.
                };
              },
            );
          }

          return { next: { ...doc, tracks: nextTracksLocal } };
        }
      } else {
        assertNoOverlap(track, item.id, startUs, nextDurationUs);
        nextProps.timelineRange = { ...item.timelineRange, durationUs: nextDurationUs };
      }
    }
  }
  if ('backgroundColor' in nextProps) {
    if (item.clipType !== 'background') {
      delete nextProps.backgroundColor;
    } else {
      nextProps.backgroundColor = sanitizeTimelineColor(nextProps.backgroundColor, '#000000');
    }
  }

  if (item.clipType === 'shape') {
    if ('shapeType' in nextProps) {
      nextProps['shapeType'] = nextProps.shapeType;
    }
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
    if ('shapeConfig' in nextProps) {
      nextProps['shapeConfig'] = nextProps.shapeConfig;
    }
  }

  if (item.clipType === 'hud') {
    if ('hudType' in nextProps) {
      nextProps['hudType'] = nextProps.hudType;
    }
    if ('background' in nextProps) {
      nextProps['background'] = nextProps.background;
    }
    if ('content' in nextProps) {
      nextProps['content'] = nextProps.content;
    }
    if ('frame' in nextProps) {
      nextProps['frame'] = nextProps.frame;
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
      const raw = nextProps['style'];
      if (!raw || typeof raw !== 'object') {
        delete nextProps['style'];
      } else {
        const rawRecord = raw as Record<string, unknown>;
        const fontFamily = typeof rawRecord.fontFamily === 'string' ? rawRecord.fontFamily : undefined;
        const widthRaw = rawRecord.width;
        const width =
          typeof widthRaw === 'number' && Number.isFinite(widthRaw) && widthRaw > 0
            ? Math.max(1, Math.min(10_000, Math.round(widthRaw)))
            : undefined;
        const fontSizeRaw = rawRecord.fontSize;
        const fontSize =
          typeof fontSizeRaw === 'number' && Number.isFinite(fontSizeRaw)
            ? Math.max(1, Math.min(1000, Math.round(fontSizeRaw)))
            : undefined;
        const fontWeight =
          typeof rawRecord.fontWeight === 'string' || typeof rawRecord.fontWeight === 'number'
            ? rawRecord.fontWeight
            : undefined;
        const color = typeof rawRecord.color === 'string' ? rawRecord.color : undefined;
        const clampAlpha = (value: unknown) =>
          typeof value === 'number' && Number.isFinite(value)
            ? Math.max(0, Math.min(1, value))
            : undefined;
        const colorAlpha = clampAlpha(rawRecord.colorAlpha);
        const alignRaw = rawRecord.align;
        const align =
          alignRaw === 'left' || alignRaw === 'center' || alignRaw === 'right'
            ? alignRaw
            : undefined;

        const verticalAlignRaw = rawRecord.verticalAlign;
        const verticalAlign =
          verticalAlignRaw === 'top' ||
          verticalAlignRaw === 'middle' ||
          verticalAlignRaw === 'bottom'
            ? verticalAlignRaw
            : undefined;

        const lineHeightRaw = rawRecord.lineHeight;
        const lineHeight =
          typeof lineHeightRaw === 'number' && Number.isFinite(lineHeightRaw)
            ? Math.max(0.1, Math.min(10, lineHeightRaw))
            : undefined;

        const letterSpacingRaw = rawRecord.letterSpacing;
        const letterSpacing =
          typeof letterSpacingRaw === 'number' && Number.isFinite(letterSpacingRaw)
            ? Math.max(-1000, Math.min(1000, letterSpacingRaw))
            : undefined;

        const backgroundColor =
          typeof rawRecord.backgroundColor === 'string' ? rawRecord.backgroundColor.trim() : undefined;
        const backgroundEnabled =
          typeof rawRecord.backgroundEnabled === 'boolean' ? rawRecord.backgroundEnabled : undefined;
        const backgroundAlpha = clampAlpha(rawRecord.backgroundAlpha);
        const backgroundRadiusRaw = rawRecord.backgroundRadius;
        const backgroundRadius =
          typeof backgroundRadiusRaw === 'number' && Number.isFinite(backgroundRadiusRaw)
            ? Math.max(0, Math.min(10_000, backgroundRadiusRaw))
            : undefined;
        const borderEnabled =
          typeof rawRecord.borderEnabled === 'boolean' ? rawRecord.borderEnabled : undefined;
        const borderColor =
          typeof rawRecord.borderColor === 'string' ? rawRecord.borderColor.trim() : undefined;
        const borderAlpha = clampAlpha(rawRecord.borderAlpha);
        const borderWidthRaw = rawRecord.borderWidth;
        const borderWidth =
          typeof borderWidthRaw === 'number' && Number.isFinite(borderWidthRaw)
            ? Math.max(0, Math.min(10_000, borderWidthRaw))
            : undefined;

        const paddingRaw = rawRecord.padding;
        const padding = (() => {
          const clampPadding = (v: unknown) =>
            typeof v === 'number' && Number.isFinite(v)
              ? Math.max(0, Math.min(10_000, v))
              : undefined;

          if (typeof paddingRaw === 'number') {
            const v = clampPadding(paddingRaw);
            return v === undefined ? undefined : { top: v, right: v, bottom: v, left: v };
          }
          if (!paddingRaw || typeof paddingRaw !== 'object') return undefined;

          const padRecord = paddingRaw as Record<string, unknown>;
          const x = clampPadding(padRecord.x);
          const y = clampPadding(padRecord.y);
          const top = clampPadding(padRecord.top);
          const right = clampPadding(padRecord.right);
          const bottom = clampPadding(padRecord.bottom);
          const left = clampPadding(padRecord.left);

          const fromXY =
            x !== undefined || y !== undefined
              ? {
                  top: y ?? 0,
                  right: x ?? 0,
                  bottom: y ?? 0,
                  left: x ?? 0,
                }
              : undefined;
          const fromEdges =
            top !== undefined || right !== undefined || bottom !== undefined || left !== undefined
              ? {
                  top: top ?? 0,
                  right: right ?? 0,
                  bottom: bottom ?? 0,
                  left: left ?? 0,
                }
              : undefined;

          const resolved = fromEdges ?? fromXY;
          if (!resolved) return undefined;
          if (
            resolved.top === 0 &&
            resolved.right === 0 &&
            resolved.bottom === 0 &&
            resolved.left === 0
          ) {
            return undefined;
          }
          return resolved;
        })();

        const safeStyle = {
          ...(fontFamily !== undefined ? { fontFamily } : {}),
          ...(width !== undefined ? { width } : {}),
          ...(fontSize !== undefined ? { fontSize } : {}),
          ...(fontWeight !== undefined ? { fontWeight } : {}),
          ...(color !== undefined ? { color } : {}),
          ...(colorAlpha !== undefined ? { colorAlpha } : {}),
          ...(align !== undefined ? { align } : {}),
          ...(verticalAlign !== undefined ? { verticalAlign } : {}),
          ...(lineHeight !== undefined ? { lineHeight } : {}),
          ...(letterSpacing !== undefined ? { letterSpacing } : {}),
          ...(backgroundEnabled !== undefined ? { backgroundEnabled } : {}),
          ...(backgroundColor !== undefined && backgroundColor.length > 0
            ? { backgroundColor }
            : {}),
          ...(backgroundAlpha !== undefined ? { backgroundAlpha } : {}),
          ...(backgroundRadius !== undefined ? { backgroundRadius } : {}),
          ...(borderEnabled !== undefined ? { borderEnabled } : {}),
          ...(borderColor !== undefined && borderColor.length > 0 ? { borderColor } : {}),
          ...(borderAlpha !== undefined ? { borderAlpha } : {}),
          ...(borderWidth !== undefined ? { borderWidth } : {}),
          ...(padding !== undefined ? { padding } : {}),
        };

        if (Object.keys(safeStyle).length === 0) {
          delete nextProps['style'];
        } else {
          nextProps['style'] = safeStyle;
        }
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
          ? (() => {
              const updated = { ...it, ...nextProps } as any;
              const durationUs = Math.max(0, Math.round(updated.timelineRange?.durationUs ?? 0));
              if (typeof updated.audioGain === 'number') {
                updated.audioGain = clampNumber(updated.audioGain, 0, 10);
              }
              if (typeof updated.audioBalance === 'number') {
                updated.audioBalance = clampNumber(updated.audioBalance, -1, 1);
              }
              if (typeof updated.audioFadeInUs === 'number') {
                updated.audioFadeInUs = clampNumber(
                  updated.audioFadeInUs,
                  0,
                  Math.max(0, durationUs - (Number(updated.audioFadeOutUs) || 0)),
                );
              }
              if (typeof updated.audioFadeOutUs === 'number') {
                updated.audioFadeOutUs = clampNumber(
                  updated.audioFadeOutUs,
                  0,
                  Math.max(0, durationUs - (Number(updated.audioFadeInUs) || 0)),
                );
              }
              if (updated.audioFadeInCurve !== undefined) {
                updated.audioFadeInCurve =
                  updated.audioFadeInCurve === 'logarithmic' ? 'logarithmic' : 'linear';
              }
              if (updated.audioFadeOutCurve !== undefined) {
                updated.audioFadeOutCurve =
                  updated.audioFadeOutCurve === 'logarithmic' ? 'logarithmic' : 'linear';
              }
              return updated;
            })()
          : it,
      );
      const normalized = autoAdaptClipTransitions(
        normalizeGaps(doc, t.id, updatedItems, { quantizeToFrames: false }),
      );
      return { ...t, items: normalized };
    }
    return t;
  });

  let finalTracks = nextTracks;
  const updatedDoc = { ...doc, tracks: nextTracks };
  const updated = findClipById(updatedDoc, cmd.itemId);
  if (updated && updated.track.kind === 'video' && updated.item.clipType === 'media') {
    if ('timelineRange' in nextProps || 'speed' in nextProps || 'sourceRange' in nextProps) {
      finalTracks = updateLinkedLockedAudio(
        { ...doc, tracks: finalTracks },
        updated.item.id,
        (a) => ({
          ...a,
          timelineRange: {
            ...a.timelineRange,
            startUs: updated.item.timelineRange.startUs,
            durationUs: updated.item.timelineRange.durationUs,
          },
          sourceRange: {
            ...a.sourceRange,
            startUs: updated.item.sourceRange.startUs,
            durationUs: updated.item.sourceRange.durationUs,
          },
          speed: updated.item.speed,
        }),
      );
    }

    if (
      'audioGain' in nextProps ||
      'audioBalance' in nextProps ||
      'audioFadeInUs' in nextProps ||
      'audioFadeOutUs' in nextProps ||
      'audioFadeInCurve' in nextProps ||
      'audioFadeOutCurve' in nextProps ||
      'audioMuted' in nextProps ||
      'audioWaveformMode' in nextProps ||
      'showWaveform' in nextProps
    ) {
      finalTracks = updateLinkedLockedAudio(
        { ...doc, tracks: finalTracks },
        updated.item.id,
        (a) => ({
          ...a,
          audioGain: updated.item.audioGain,
          audioBalance: updated.item.audioBalance,
          audioFadeInUs: updated.item.audioFadeInUs,
          audioFadeOutUs: updated.item.audioFadeOutUs,
          audioFadeInCurve: updated.item.audioFadeInCurve,
          audioFadeOutCurve: updated.item.audioFadeOutCurve,
          audioMuted: updated.item.audioMuted,
          audioWaveformMode: updated.item.audioWaveformMode,
          showWaveform: updated.item.showWaveform,
        }),
      );
    }
  }

  return { next: { ...doc, tracks: finalTracks } };
}

export function updateClipTransition(
  doc: TimelineDocument,
  cmd: UpdateClipTransitionCommand,
): TimelineCommandResult {
  const track = getTrackById(doc, cmd.trackId);
  const item = track.items.find((x) => x.id === cmd.itemId);
  if (!item || item.kind !== 'clip') return { next: doc };

  const itemId = item.id;

  function coerceTransition(raw: any): {
    type: string;
    durationUs: number;
    mode: TransitionMode;
    curve: TransitionCurve;
    params?: Record<string, unknown>;
    isOverridden?: boolean;
  } | null {
    if (!raw) return null;
    const type = typeof raw.type === 'string' ? raw.type : '';
    const durationUs = Number(raw.durationUs);
    if (!type) return null;
    if (!Number.isFinite(durationUs) || durationUs <= 0) {
      return {
        type,
        durationUs: 0,
        mode: normalizeTransitionMode(raw.mode),
        curve: normalizeTransitionCurve(raw.curve),
        params: normalizeTransitionParams(type, raw.params) as Record<string, unknown> | undefined,
        isOverridden: raw.isOverridden,
      };
    }
    return {
      type,
      durationUs: Math.max(0, Math.round(durationUs)),
      mode: normalizeTransitionMode(raw.mode),
      curve: normalizeTransitionCurve(raw.curve),
      params: normalizeTransitionParams(type, raw.params) as Record<string, unknown> | undefined,
      isOverridden: raw.isOverridden,
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
