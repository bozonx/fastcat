import type {
  TimelineDocument,
  TimelineMarker,
  TimelineTrack,
  TimelineTrackItem,
  ClipTransition,
} from './types';
import type {
  OtioTrack,
  OtioTrackChild,
  OtioMediaReference,
  OtioTimeline,
  OtioGap,
  OtioClip,
} from './otio/types';
import {
  toTimeRange,
  trackKindToOtioKind,
  trackKindFromOtioKind,
  normalizeTrackKind,
  assertTimelineTimebase,
  coerceId,
  coerceName,
  coerceBlendMode,
  safeFastCatMetadata,
} from './otio/utils';
import {
  serializeEffects,
  parseEffects,
  serializeMarker,
  parseOtioMarkers,
  buildOtioTransition,
  parseOtioTransition,
} from './otio/serialization';
import { parseGapItem, parseClipItem, parseItemSequenceDurationUs } from './otio/items';
import { TimelineDocFastCatMetaSchema, TimelineTrackFastCatMetaSchema } from './otio/schemas';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createDefaultTimelineDocument(params: {
  id: string;
  name: string;
  fps: number;
}): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: params.id,
    name: params.name,
    timebase: { fps: params.fps },
    tracks: [
      { id: 'v2', kind: 'video', name: 'Video 2', videoHidden: false, items: [] },
      { id: 'v1', kind: 'video', name: 'Video 1', videoHidden: false, items: [] },
      { id: 'a1', kind: 'audio', name: 'Audio 1', audioMuted: false, audioSolo: false, items: [] },
      { id: 'a2', kind: 'audio', name: 'Audio 2', audioMuted: false, audioSolo: false, items: [] },
    ],
    metadata: {
      fastcat: {
        version: 1,
        docId: params.id,
        timebase: { fps: params.fps },
      },
    },
  };
}

export function serializeTimelineToOtio(doc: TimelineDocument): string {
  const fps = doc.timebase?.fps;

  const tracks: OtioTrack[] = doc.tracks.map((t) => {
    const sortedItems = [...t.items].sort(
      (a, b) => a.timelineRange.startUs - b.timelineRange.startUs,
    );
    const children: OtioTrackChild[] = [];
    let cursorUs = 0;

    for (const item of sortedItems) {
      const startUs = Math.max(0, Math.round(item.timelineRange.startUs));
      const durationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

      if (startUs > cursorUs) {
        children.push({
          OTIO_SCHEMA: 'Gap.1',
          name: 'gap',
          source_range: toTimeRange({ startUs: 0, durationUs: startUs - cursorUs }, fps),
          metadata: { fastcat: { id: `gap_${t.id}_${cursorUs}` } },
        });
        cursorUs = startUs;
      }

      if (item.kind === 'gap') {
        children.push({
          OTIO_SCHEMA: 'Gap.1',
          name: 'gap',
          source_range: toTimeRange({ startUs: 0, durationUs }, fps),
          metadata: { fastcat: { id: item.id } },
        });
        cursorUs += durationUs;
        continue;
      }

      // Emit transitionIn as a Transition.1 *before* this clip.
      if (item.transitionIn) {
        const t1 = buildOtioTransition(item.transitionIn, `${item.name}_transition_in`, fps, {
          itemId: item.id,
          edge: 'in',
        });
        if (t1) children.push(t1);
      }

      const path =
        item.clipType === 'media' || item.clipType === 'timeline' ? item.source.path : '';

      const mediaReference: OtioMediaReference = path
        ? {
            OTIO_SCHEMA: 'ExternalReference.1',
            target_url: path,
            available_range:
              item.clipType === 'media' || item.clipType === 'timeline'
                ? toTimeRange({ startUs: 0, durationUs: item.sourceDurationUs }, fps)
                : undefined,
          }
        : { OTIO_SCHEMA: 'MissingReference.1' };

      children.push({
        OTIO_SCHEMA: 'Clip.1',
        name: item.name,
        enabled: item.disabled ? false : undefined,
        media_reference: mediaReference,
        source_range: toTimeRange(item.sourceRange, fps),
        effects: serializeEffects(item.effects),
        metadata: {
          fastcat: {
            id: item.id,
            clipType: item.clipType,
            source: {
              durationUs: item.sourceDurationUs,
            },
            playback: {
              speed: item.speed,
              freezeFrameSourceUs: item.clipType === 'media' ? item.freezeFrameSourceUs : undefined,
            },
            audio: {
              gain: item.audioGain,
              balance: item.audioBalance,
              fadeInUs: item.audioFadeInUs,
              fadeOutUs: item.audioFadeOutUs,
              fadeInCurve: item.audioFadeInCurve,
              fadeOutCurve: item.audioFadeOutCurve,
              muted: item.audioMuted,
              waveformMode: item.audioWaveformMode,
              showWaveform: item.showWaveform,
              fromVideoDisabled:
                item.clipType === 'media' ? Boolean(item.audioFromVideoDisabled) : undefined,
            },
            visual: {
              opacity: item.opacity,
              blendMode: item.blendMode,
              showThumbnails: item.showThumbnails,
              isImage: item.isImage,
            },
            flags: {
              locked: item.locked ? true : undefined,
              speedActive: item.speedActive,
              transformActive: item.transformActive,
              audioFadesActive: item.audioFadesActive,
              opacityActive: item.opacityActive,
              blendModeActive: item.blendModeActive,
              maskActive: item.maskActive,
              ignored: item.ignored,
            },
            links: {
              linkedGroupId: item.linkedGroupId,
              linkedVideoClipId: item.clipType === 'media' ? item.linkedVideoClipId : undefined,
              lockToLinkedVideo: item.clipType === 'media' ? item.lockToLinkedVideo : undefined,
            },
            transform: item.transform,
            mask: item.mask,
            transitions: {
              in: item.transitionIn,
              out: item.transitionOut,
            },
            typeData: {
              background:
                item.clipType === 'background'
                  ? { color: (item as any).backgroundColor }
                  : undefined,
              text:
                item.clipType === 'text'
                  ? { text: (item as any).text, style: (item as any).style }
                  : undefined,
              shape:
                item.clipType === 'shape'
                  ? {
                      type: (item as any).shapeType,
                      fillColor: (item as any).fillColor,
                      strokeColor: (item as any).strokeColor,
                      strokeWidth: (item as any).strokeWidth,
                      config: (item as any).shapeConfig,
                    }
                  : undefined,
              hud:
                item.clipType === 'hud'
                  ? {
                      type: (item as any).hudType,
                      background: (item as any).background,
                      content: (item as any).content,
                      frame: (item as any).frame,
                    }
                  : undefined,
            },
          },
        },
      });

      // Emit transitionOut as a Transition.1 *after* this clip.
      if (item.transitionOut) {
        const t1 = buildOtioTransition(item.transitionOut, `${item.name}_transition_out`, fps, {
          itemId: item.id,
          edge: 'out',
        });
        if (t1) children.push(t1);
      }

      cursorUs += durationUs;
    }

    return {
      OTIO_SCHEMA: 'Track.1',
      name: t.name,
      kind: trackKindToOtioKind(t.kind),
      children,
      effects: serializeEffects(t.effects),
      metadata: {
        fastcat: {
          id: t.id,
          kind: t.kind,
          video: {
            hidden: t.kind === 'video' ? Boolean(t.videoHidden) : undefined,
            opacity: t.opacity,
            blendMode: t.blendMode,
          },
          audio: {
            muted: Boolean(t.audioMuted),
            solo: Boolean(t.audioSolo),
            gain: t.audioGain,
            balance: t.audioBalance,
          },
          appearance: {
            color: t.color,
          },
          flags: {
            locked: t.locked ? true : undefined,
          },
        },
      },
    };
  });

  const fastcatMeta = doc.metadata?.fastcat;
  const markers = Array.isArray(fastcatMeta?.markers)
    ? [...(fastcatMeta.markers as TimelineMarker[])]
        .sort((a, b) => a.timeUs - b.timeUs)
        .map((m) => serializeMarker(m, fps))
    : [];

  const payload: OtioTimeline = {
    OTIO_SCHEMA: 'Timeline.1',
    name: doc.name,
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      children: tracks,
    },
    markers,
    metadata: {
      fastcat: {
        version: 1,
        docId: doc.id,
        timebase: doc.timebase,
        audio: {
          masterGain: fastcatMeta?.masterGain,
          masterMuted: fastcatMeta?.masterMuted,
          masterEffects: Array.isArray(fastcatMeta?.masterEffects)
            ? fastcatMeta.masterEffects
            : undefined,
        },
      },
    },
  };

  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function parseTimelineFromOtio(
  text: string,
  fallback: { id: string; name: string; fps: number },
): TimelineDocument {
  let parsed: OtioTimeline | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return createDefaultTimelineDocument({
      id: fallback.id,
      name: fallback.name,
      fps: fallback.fps,
    });
  }

  if (!parsed || parsed.OTIO_SCHEMA !== 'Timeline.1') {
    return createDefaultTimelineDocument({
      id: fallback.id,
      name: fallback.name,
      fps: fallback.fps,
    });
  }

  const fastcatMeta = TimelineDocFastCatMetaSchema.parse((parsed.metadata as any)?.fastcat ?? {});
  const timebase = assertTimelineTimebase(fastcatMeta.timebase ?? { fps: fallback.fps });

  const stackChildren = Array.isArray((parsed.tracks as any)?.children)
    ? (parsed.tracks as any).children
    : [];

  const tracks: TimelineTrack[] = stackChildren.map((otioTrack: OtioTrack, trackIndex: number) => {
    const trackFastCatMeta = TimelineTrackFastCatMetaSchema.parse(
      safeFastCatMetadata(otioTrack.metadata),
    );

    const id = coerceId(
      trackFastCatMeta.id,
      `${otioTrack.kind === 'Audio' ? 'a' : 'v'}${trackIndex + 1}`,
    );
    const kind = normalizeTrackKind(trackFastCatMeta.kind) ?? trackKindFromOtioKind(otioTrack.kind);
    const name = coerceName(
      otioTrack.name,
      kind === 'audio' ? `Audio ${trackIndex + 1}` : `Video ${trackIndex + 1}`,
    );

    const children = Array.isArray(otioTrack.children) ? otioTrack.children : [];
    const occupiedIds = new Set<string>();
    let cursorUs = 0;

    // Pre-scan track children to associate adjacent Transition.1 nodes with clips.
    // A Transition.1 before a Clip becomes transitionIn; one after becomes transitionOut.
    let pendingTransitionIn: ClipTransition | null = null;

    const rawItems: TimelineTrackItem[] = [];

    for (let i = 0; i < children.length; i += 1) {
      const child = children[i] as any;

      if (child?.OTIO_SCHEMA === 'Transition.1') {
        const transition = parseOtioTransition(child);
        if (transition) {
          const transitionMeta = safeFastCatMetadata(child.metadata);
          const ownerMeta =
            transitionMeta.owner && typeof transitionMeta.owner === 'object'
              ? (transitionMeta.owner as Record<string, unknown>)
              : {};
          const transitionEdge = ownerMeta.edge;
          const prev = rawItems[rawItems.length - 1];

          if (transitionEdge === 'out') {
            if (prev && prev.kind === 'clip') {
              (prev as any).transitionOut = transition;
            }
            pendingTransitionIn = null;
            continue;
          }

          if (transitionEdge === 'in') {
            pendingTransitionIn = transition;
            continue;
          }

          if (prev && prev.kind === 'clip') {
            (prev as any).transitionOut = transition;
          }
          pendingTransitionIn = transition;
        }
        continue;
      }

      if (child?.OTIO_SCHEMA === 'Gap.1') {
        const item = parseGapItem({
          trackId: id,
          otio: child as OtioGap,
          index: i,
          occupiedIds,
          fallbackStartUs: cursorUs,
        });
        rawItems.push(item);
        cursorUs += parseItemSequenceDurationUs(child);
        pendingTransitionIn = null;
        continue;
      }

      if (child?.OTIO_SCHEMA === 'Clip.1') {
        const item = parseClipItem({
          trackId: id,
          otio: child as OtioClip,
          index: i,
          occupiedIds,
          fallbackStartUs: cursorUs,
          transitionIn: pendingTransitionIn ?? undefined,
        });
        rawItems.push(item);
        cursorUs += parseItemSequenceDurationUs(child);
        pendingTransitionIn = null;
        continue;
      }
    }

    const items = [...rawItems].sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

    const videoHidden = kind === 'video' ? Boolean(trackFastCatMeta.video?.hidden) : undefined;
    const opacity = trackFastCatMeta.video?.opacity;
    const blendMode = coerceBlendMode(trackFastCatMeta.video?.blendMode);
    const audioMuted = Boolean(trackFastCatMeta.audio?.muted);
    const audioSolo = Boolean(trackFastCatMeta.audio?.solo);
    const audioGain = trackFastCatMeta.audio?.gain;
    const audioBalance = trackFastCatMeta.audio?.balance;
    const color = trackFastCatMeta.appearance?.color;
    const locked = trackFastCatMeta.flags?.locked ? true : undefined;

    // Track effects: prefer OTIO standard, fallback to fastcat metadata.
    const effects =
      Array.isArray(otioTrack.effects) && otioTrack.effects.length > 0
        ? parseEffects(otioTrack.effects)
        : undefined;

    // Track-level markers (e.g. from an external OTIO).
    const trackMarkers =
      Array.isArray((otioTrack as any).markers) && (otioTrack as any).markers.length > 0
        ? parseOtioMarkers((otioTrack as any).markers)
        : undefined;

    return {
      id,
      kind,
      name,
      videoHidden,
      opacity,
      blendMode,
      audioMuted,
      audioSolo,
      audioGain,
      audioBalance,
      color,
      locked,
      effects,
      items,
      ...(trackMarkers && trackMarkers.length > 0 ? { markers: trackMarkers } : {}),
    };
  });

  const video = tracks.filter((t) => t.kind === 'video');
  const audio = tracks.filter((t) => t.kind === 'audio');

  const getTrackIndex = (id: string) => {
    const m = id.match(/^(?:v|a)(\d+)$/);
    return m && m[1] ? parseInt(m[1], 10) : null;
  };

  video.sort((a, b) => {
    const ia = getTrackIndex(a.id);
    const ib = getTrackIndex(b.id);
    if (ia !== null && ib !== null) return ib - ia;
    return 0;
  });

  audio.sort((a, b) => {
    const ia = getTrackIndex(a.id);
    const ib = getTrackIndex(b.id);
    if (ia !== null && ib !== null) return ia - ib;
    return 0;
  });

  const normalizedTracks = [...video, ...audio];

  const docId = coerceId(fastcatMeta.docId, fallback.id);
  const version = typeof fastcatMeta.version === 'number' ? fastcatMeta.version : 0;
  const name = coerceName(parsed.name, fallback.name);

  // Markers: prefer standard OTIO markers on Timeline, fallback to fastcat metadata for old files.
  const markers =
    Array.isArray(parsed.markers) && (parsed.markers as any[]).length > 0
      ? parseOtioMarkers(parsed.markers as any[])
      : [];

  const masterEffects = fastcatMeta.audio?.masterEffects;
  const masterGain = fastcatMeta.audio?.masterGain;
  const masterMuted = fastcatMeta.audio?.masterMuted;

  if (normalizedTracks.length === 0) {
    const base = createDefaultTimelineDocument({ id: docId, name, fps: timebase.fps });
    base.metadata = {
      ...(base.metadata ?? {}),
      fastcat: {
        ...(base.metadata?.fastcat ?? {}),
        version,
        docId,
        timebase,
        markers,
        masterEffects,
        masterGain,
        masterMuted,
      },
    };
    return base;
  }

  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: docId,
    name,
    timebase,
    tracks: normalizedTracks,
    metadata: {
      fastcat: {
        version,
        docId,
        timebase,
        markers,
        masterEffects,
        masterGain,
        masterMuted,
      },
    },
  };
}
