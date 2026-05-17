import type {
  TimelineDocument,
  TimelineMarker,
  TimelineTrack,
  TimelineTrackItem,
  TimelineClipItem,
  TimelineRange,
  ClipTransition,
} from './types';
import type {
  OtioTrack,
  OtioTrackChild,
  OtioMediaReference,
  OtioTimeline,
  OtioGap,
  OtioAnyClip,
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
  toOtioColor,
  fromOtioColor,
  OtioValidationReport,
} from './otio/utils';
import {
  serializeEffects,
  parseEffects,
  serializeMarker,
  parseOtioMarkers,
  buildOtioTransition,
  parseOtioTransition,
  serializeTimeEffects,
  parseTimeEffects,
} from './otio/serialization';
import { parseGapItem, parseClipItem, parseItemSequenceDurationUs } from './otio/items';
import {
  TimelineDocFastCatMetaSchema,
  TimelineDocFastCatMetaLegacySchema,
  TimelineTrackFastCatMetaSchema,
  TimelineClipFastCatMetaSchema,
} from './otio/schemas';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function sortTracksForOtioStack(tracks: TimelineTrack[]): TimelineTrack[] {
  const videoTracks = tracks.filter((track) => track.kind === 'video').reverse();
  const audioTracks = tracks.filter((track) => track.kind === 'audio');

  return [...videoTracks, ...audioTracks];
}

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

// ---------------------------------------------------------------------------
// Transition overlap calculation
// ---------------------------------------------------------------------------

function calculateTransitionOverlaps(
  items: TimelineTrackItem[],
): Map<string, { leftOverlapUs: number; rightOverlapUs: number }> {
  const overlaps = new Map<string, { leftOverlapUs: number; rightOverlapUs: number }>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind !== 'clip') continue;

    const prevItem = i > 0 ? items[i - 1] : null;
    const nextItem = i < items.length - 1 ? items[i + 1] : null;

    let leftOverlapUs = 0;
    let rightOverlapUs = 0;

    const prevIsClip = prevItem?.kind === 'clip';
    const prevClip = prevIsClip ? (prevItem as TimelineClipItem) : null;
    const hasSharedTransitionIn = prevClip && prevClip.transitionOut && item.transitionIn;

    if (hasSharedTransitionIn) {
      const sharedDuration = Math.max(
        prevClip!.transitionOut!.durationUs,
        item.transitionIn!.durationUs,
      );
      leftOverlapUs = Math.round(sharedDuration / 2);
    } else if (item.transitionIn) {
      leftOverlapUs = Math.round(item.transitionIn.durationUs);
    }

    const nextIsClip = nextItem?.kind === 'clip';
    const nextClip = nextIsClip ? (nextItem as TimelineClipItem) : null;
    const hasSharedTransitionOut = nextClip && item.transitionOut && nextClip.transitionIn;

    if (hasSharedTransitionOut) {
      const sharedDuration = Math.max(
        item.transitionOut!.durationUs,
        nextClip!.transitionIn!.durationUs,
      );
      rightOverlapUs = Math.round(sharedDuration / 2);
    } else if (item.transitionOut) {
      rightOverlapUs = Math.round(item.transitionOut.durationUs);
    }

    overlaps.set(item.id, { leftOverlapUs, rightOverlapUs });
  }

  return overlaps;
}

// ---------------------------------------------------------------------------
// Track serialization
// ---------------------------------------------------------------------------

function serializeTrackItems(
  items: TimelineTrackItem[],
  trackId: string,
  fps?: number,
): OtioTrackChild[] {
  const sortedItems = [...items].sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);
  const overlaps = calculateTransitionOverlaps(sortedItems);
  const children: OtioTrackChild[] = [];
  let cursorUs = 0;

  for (let i = 0; i < sortedItems.length; i++) {
    const item = sortedItems[i];
    const startUs = Math.max(0, Math.round(item.timelineRange.startUs));
    const durationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

    if (startUs > cursorUs) {
      children.push({
        OTIO_SCHEMA: 'Gap.1',
        name: 'gap',
        source_range: toTimeRange({ startUs: 0, durationUs: startUs - cursorUs }, fps),
        metadata: { fastcat: { id: `gap_${trackId}_${cursorUs}` } },
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

    const prevItem = i > 0 ? sortedItems[i - 1] : null;
    const nextItem = i < sortedItems.length - 1 ? sortedItems[i + 1] : null;
    const overlap = overlaps.get(item.id)!;

    const prevIsClip = prevItem?.kind === 'clip';
    const prevClip = prevIsClip ? (prevItem as TimelineClipItem) : null;
    const hasSharedTransitionIn = prevClip && prevClip.transitionOut && item.transitionIn;

    // Emit edge transitionIn before this clip
    if (item.transitionIn && !hasSharedTransitionIn) {
      const t1 = buildOtioTransition(
        item.transitionIn,
        `${item.name}_transition_in`,
        fps,
        { itemId: item.id, edge: 'in' },
        { inOffsetUs: 0, outOffsetUs: Math.round(item.transitionIn.durationUs) },
      );
      if (t1) children.push(t1);
    }

    const path = item.clipType === 'media' || item.clipType === 'timeline' ? item.source.path : '';

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

    const adjustedSourceRange: TimelineRange = {
      startUs: item.sourceRange.startUs + overlap.leftOverlapUs,
      durationUs: Math.max(
        0,
        item.sourceRange.durationUs - overlap.leftOverlapUs - overlap.rightOverlapUs,
      ),
    };

    // Use Clip.2 when disabled to be explicit about the schema version
    const clipSchema: 'Clip.1' | 'Clip.2' = item.disabled ? 'Clip.2' : 'Clip.1';

    const standardEffects = serializeEffects(item.effects);
    const timeEffects = serializeTimeEffects({
      speed: item.speed,
      speedActive: item.speedActive,
      freezeFrameSourceUs: item.clipType === 'media' ? item.freezeFrameSourceUs : undefined,
      fps,
    });
    const allEffects = [...(standardEffects ?? []), ...(timeEffects ?? [])];

    // Build discriminated typeData
    const typeData =
      item.clipType === 'background'
        ? { kind: 'background' as const, color: (item as any).backgroundColor }
        : item.clipType === 'text'
          ? { kind: 'text' as const, text: (item as any).text, style: (item as any).style }
          : item.clipType === 'shape'
            ? {
                kind: 'shape' as const,
                type: (item as any).shapeType,
                fillColor: (item as any).fillColor,
                strokeColor: (item as any).strokeColor,
                strokeWidth: (item as any).strokeWidth,
                config: (item as any).shapeConfig,
              }
            : item.clipType === 'hud'
              ? {
                  kind: 'hud' as const,
                  type: (item as any).hudType,
                  background: (item as any).background,
                  content: (item as any).content,
                  frame: (item as any).frame,
                }
              : undefined;

    children.push({
      OTIO_SCHEMA: clipSchema,
      name: item.name,
      enabled: item.disabled ? false : undefined,
      media_reference: mediaReference,
      source_range: toTimeRange(adjustedSourceRange, fps),
      effects: allEffects.length > 0 ? allEffects : undefined,
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
            fromVideoDisabled:
              item.clipType === 'media' ? Boolean(item.audioFromVideoDisabled) : undefined,
          },
          visual: {
            opacity: item.opacity,
            blendMode: item.blendMode,
            isImage: item.isImage,
          },
          flags: {
            locked: item.locked ? true : undefined,
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
          ...(typeData ? { typeData } : {}),
          roundtrip: {
            timelineRange: item.timelineRange,
            sourceRange: item.sourceRange,
          },
        },
      },
    });

    // Emit transition AFTER this clip
    const nextIsClip = nextItem?.kind === 'clip';
    const nextClip = nextIsClip ? (nextItem as TimelineClipItem) : null;
    const hasSharedTransitionOut = nextClip && item.transitionOut && nextClip.transitionIn;

    if (hasSharedTransitionOut) {
      const sharedDuration = Math.max(
        item.transitionOut!.durationUs,
        nextClip!.transitionIn!.durationUs,
      );
      const half = Math.round(sharedDuration / 2);
      const t1 = buildOtioTransition(
        item.transitionOut,
        `${item.name}_transition_out`,
        fps,
        { itemId: item.id, edge: 'out' },
        { inOffsetUs: half, outOffsetUs: sharedDuration - half },
      );
      if (t1) children.push(t1);
    } else if (item.transitionOut) {
      const t1 = buildOtioTransition(
        item.transitionOut,
        `${item.name}_transition_out`,
        fps,
        { itemId: item.id, edge: 'out' },
        { inOffsetUs: Math.round(item.transitionOut.durationUs), outOffsetUs: 0 },
      );
      if (t1) children.push(t1);
    }

    cursorUs += durationUs;
  }

  return children;
}

export function serializeTimelineToOtio(doc: TimelineDocument): string {
  const fps = doc.timebase?.fps;

  const tracks: OtioTrack[] = sortTracksForOtioStack(doc.tracks).map((t) => {
    const children = serializeTrackItems(t.items, t.id, fps);

    return {
      OTIO_SCHEMA: 'Track.1',
      name: t.name,
      kind: trackKindToOtioKind(t.kind),
      children,
      effects: serializeEffects(t.effects),
      markers: Array.isArray(t.markers)
        ? [...t.markers].sort((a, b) => a.timeUs - b.timeUs).map((m) => serializeMarker(m, fps))
        : undefined,
      color: toOtioColor(t.color),
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

  // Grouped document metadata (new format)
  const payload: OtioTimeline = {
    OTIO_SCHEMA: 'Timeline.1',
    name: doc.name,
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      children: tracks,
      markers,
    },
    metadata: {
      fastcat: {
        schema: 'fastcat.otio.v1',
        version: 1,
        document: {
          docId: doc.id,
          timebase: doc.timebase,
        },
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

// ---------------------------------------------------------------------------
// Document metadata parsing (grouped + legacy fallback)
// ---------------------------------------------------------------------------

function parseDocumentMetadata(raw: unknown): {
  docId?: string;
  timebase?: { fps: number };
  masterGain?: number;
  masterMuted?: boolean;
  masterEffects?: unknown[];
  markers?: TimelineMarker[];
  version?: number;
} {
  const grouped = TimelineDocFastCatMetaSchema.parse(raw);

  // New grouped format
  if (grouped.schema || grouped.document) {
    return {
      docId: coerceId(grouped.document?.docId ?? grouped.docId, ''),
      timebase: grouped.document?.timebase ?? grouped.timebase,
      masterGain: grouped.audio?.masterGain,
      masterMuted: grouped.audio?.masterMuted,
      masterEffects: grouped.audio?.masterEffects,
      version: grouped.version,
    };
  }

  // Legacy flat format
  const legacy = TimelineDocFastCatMetaLegacySchema.parse(raw);
  return {
    docId: legacy.docId,
    timebase: legacy.timebase,
    masterGain: legacy.audio?.masterGain,
    masterMuted: legacy.audio?.masterMuted,
    masterEffects: legacy.audio?.masterEffects,
    version: legacy.version,
  };
}

// ---------------------------------------------------------------------------
// Timeline parsing
// ---------------------------------------------------------------------------

export function parseTimelineFromOtio(
  text: string,
  fallback: { id: string; name: string; fps: number },
): TimelineDocument {
  const report = new OtioValidationReport();

  let parsed: OtioTimeline | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    report.warn('invalid_json', 'Failed to parse OTIO JSON.');
    report.log();
    return createDefaultTimelineDocument({
      id: fallback.id,
      name: fallback.name,
      fps: fallback.fps,
    });
  }

  if (!parsed || parsed.OTIO_SCHEMA !== 'Timeline.1') {
    report.warn('invalid_schema', `Expected Timeline.1, got ${(parsed as any)?.OTIO_SCHEMA}.`);
    report.log();
    return createDefaultTimelineDocument({
      id: fallback.id,
      name: fallback.name,
      fps: fallback.fps,
    });
  }

  const docMeta = parseDocumentMetadata((parsed.metadata as any)?.fastcat ?? {});
  const timebase = assertTimelineTimebase(docMeta.timebase ?? { fps: fallback.fps });

  const stackChildren = Array.isArray((parsed.tracks as any)?.children)
    ? (parsed.tracks as any).children
    : [];

  const tracks: TimelineTrack[] = stackChildren.map((otioTrack: any, trackIndex: number) => {
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
    let pendingTransitionIn: ClipTransition | null = null;

    const rawItems: import('./types').TimelineTrackItem[] = [];

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
        } else {
          report.warn(
            'malformed_transition',
            'Dropped malformed Transition.1 node.',
            `tracks[${id}].children[${i}]`,
          );
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

      if (child?.OTIO_SCHEMA === 'Clip.1' || child?.OTIO_SCHEMA === 'Clip.2') {
        const item = parseClipItem({
          trackId: id,
          otio: child as OtioAnyClip,
          index: i,
          occupiedIds,
          fallbackStartUs: cursorUs,
          transitionIn: pendingTransitionIn ?? undefined,
          report,
        });
        rawItems.push(item);
        cursorUs += parseItemSequenceDurationUs(child);
        pendingTransitionIn = null;
        continue;
      }

      report.warn(
        'unknown_child',
        `Unknown track child schema: ${child?.OTIO_SCHEMA}`,
        `tracks[${id}].children[${i}]`,
      );
    }

    const items = [...rawItems].sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

    const videoHidden = kind === 'video' ? Boolean(trackFastCatMeta.video?.hidden) : undefined;
    const opacity = trackFastCatMeta.video?.opacity;
    const blendMode = coerceBlendMode(trackFastCatMeta.video?.blendMode);
    const audioMuted = Boolean(trackFastCatMeta.audio?.muted);
    const audioSolo = Boolean(trackFastCatMeta.audio?.solo);
    const audioGain = trackFastCatMeta.audio?.gain;
    const audioBalance = trackFastCatMeta.audio?.balance;
    const color = fromOtioColor(otioTrack.color) ?? trackFastCatMeta.appearance?.color;
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
  const clipIds = new Set(
    normalizedTracks.flatMap((track) =>
      track.items.filter((item) => item.kind === 'clip').map((item) => item.id),
    ),
  );
  const tracksWithValidLinks = normalizedTracks.map((track) => ({
    ...track,
    items: track.items.map((item) => {
      if (item.kind !== 'clip' || !item.linkedVideoClipId || clipIds.has(item.linkedVideoClipId)) {
        return item;
      }

      report.warn(
        'broken_link',
        `Dropping broken linkedVideoClipId "${item.linkedVideoClipId}" on clip "${item.id}".`,
        `tracks[${track.id}].items[${item.id}]`,
      );

      const next = { ...item };
      delete (next as any).linkedVideoClipId;
      delete (next as any).lockToLinkedVideo;

      return next;
    }),
  }));

  const docId = coerceId(docMeta.docId, fallback.id);
  const version = typeof docMeta.version === 'number' ? docMeta.version : 0;
  const name = coerceName(parsed.name, fallback.name);

  // Markers: prefer standard OTIO markers on Stack, fallback to Timeline for old files.
  const markers =
    Array.isArray((parsed.tracks as any)?.markers) &&
    ((parsed.tracks as any).markers as any[]).length > 0
      ? parseOtioMarkers((parsed.tracks as any).markers as any[])
      : Array.isArray(parsed.markers) && (parsed.markers as any[]).length > 0
        ? parseOtioMarkers(parsed.markers as any[])
        : [];

  const masterEffects = docMeta.masterEffects;
  const masterGain = docMeta.masterGain;
  const masterMuted = docMeta.masterMuted;

  if (tracksWithValidLinks.length === 0) {
    report.warn('no_tracks', 'No valid tracks found; creating default timeline.');
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
    report.log();
    return base;
  }

  report.log();

  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: docId,
    name,
    timebase,
    tracks: tracksWithValidLinks,
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
