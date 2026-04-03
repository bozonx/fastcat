import type {
  TimelineDocument,
  TimelineMarker,
  TimelineSelectionRange,
  TimelineTrack,
  TimelineTrackItem,
  ClipTransition,
  ClipEffect,
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

function coerceSelectionRange(raw: unknown): TimelineSelectionRange | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const startUs = Number((raw as any).startUs);
  const endUs = Number((raw as any).endUs);
  if (!Number.isFinite(startUs) || !Number.isFinite(endUs)) return undefined;

  const nextStartUs = Math.max(0, Math.round(startUs));
  const nextEndUs = Math.max(nextStartUs, Math.round(endUs));

  if (nextEndUs <= nextStartUs) return undefined;

  return { startUs: nextStartUs, endUs: nextEndUs };
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
            locked: item.locked ? true : undefined,
            speed: item.speed,
            audioGain: item.audioGain,
            audioBalance: item.audioBalance,
            audioFadeInUs: item.audioFadeInUs,
            audioFadeOutUs: item.audioFadeOutUs,
            audioFadeInCurve: item.audioFadeInCurve,
            audioFadeOutCurve: item.audioFadeOutCurve,
            audioMuted: item.audioMuted,
            audioWaveformMode: item.audioWaveformMode,
            showWaveform: item.showWaveform,
            audioFromVideoDisabled:
              item.clipType === 'media' ? Boolean(item.audioFromVideoDisabled) : undefined,
            freezeFrameSourceUs: item.clipType === 'media' ? item.freezeFrameSourceUs : undefined,
            opacity: item.opacity,
            blendMode: item.blendMode,
            transitionIn: item.transitionIn,
            transitionOut: item.transitionOut,
            linkedGroupId: item.linkedGroupId,
            linkedVideoClipId: item.clipType === 'media' ? item.linkedVideoClipId : undefined,
            lockToLinkedVideo: item.clipType === 'media' ? item.lockToLinkedVideo : undefined,
            backgroundColor:
              item.clipType === 'background' ? (item as any).backgroundColor : undefined,
            text: item.clipType === 'text' ? (item as any).text : undefined,
            style: item.clipType === 'text' ? (item as any).style : undefined,
            shapeType: item.clipType === 'shape' ? (item as any).shapeType : undefined,
            fillColor: item.clipType === 'shape' ? (item as any).fillColor : undefined,
            strokeColor: item.clipType === 'shape' ? (item as any).strokeColor : undefined,
            strokeWidth: item.clipType === 'shape' ? (item as any).strokeWidth : undefined,
            shapeConfig: item.clipType === 'shape' ? (item as any).shapeConfig : undefined,
            hudType: item.clipType === 'hud' ? (item as any).hudType : undefined,
            background: item.clipType === 'hud' ? (item as any).background : undefined,
            content: item.clipType === 'hud' ? (item as any).content : undefined,
            frame: item.clipType === 'hud' ? (item as any).frame : undefined,
            isImage: item.isImage,
            transform: item.transform,
            mask: item.mask,
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
          videoHidden: t.kind === 'video' ? Boolean(t.videoHidden) : undefined,
          opacity: t.opacity,
          blendMode: t.blendMode,
          audioMuted: Boolean(t.audioMuted),
          audioSolo: Boolean(t.audioSolo),
          audioGain: t.audioGain,
          audioBalance: t.audioBalance,
          color: t.color,
          locked: t.locked ? true : undefined,
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
        selectionRange: coerceSelectionRange(fastcatMeta?.selectionRange),
        snapThresholdPx: fastcatMeta?.snapThresholdPx,
        playheadUs: fastcatMeta?.playheadUs,
        masterGain: fastcatMeta?.masterGain,
        masterMuted: fastcatMeta?.masterMuted,
        masterEffects: Array.isArray(fastcatMeta?.masterEffects)
          ? fastcatMeta.masterEffects
          : undefined,
        zoom: fastcatMeta?.zoom,
        trackHeights:
          fastcatMeta?.trackHeights && typeof fastcatMeta.trackHeights === 'object'
            ? { ...fastcatMeta.trackHeights }
            : undefined,
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
    const kind =
      trackFastCatMeta.kind === 'audio' || trackFastCatMeta.kind === 'video'
        ? trackFastCatMeta.kind
        : trackKindFromOtioKind(otioTrack.kind);
    const name = coerceName(
      trackFastCatMeta?.name ?? otioTrack.name,
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
          const transitionEdge = transitionMeta?.edge;
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

    const videoHidden = kind === 'video' ? Boolean(trackFastCatMeta.videoHidden) : undefined;
    const opacity = trackFastCatMeta.opacity;
    const blendMode = coerceBlendMode(trackFastCatMeta.blendMode);
    const audioMuted = Boolean(trackFastCatMeta.audioMuted);
    const audioSolo = Boolean(trackFastCatMeta.audioSolo);
    const audioGain = trackFastCatMeta.audioGain;
    const audioBalance = trackFastCatMeta.audioBalance;
    const color = trackFastCatMeta.color;
    const locked = trackFastCatMeta.locked ? true : undefined;

    // Track effects: prefer OTIO standard, fallback to fastcat metadata.
    const effects =
      Array.isArray(otioTrack.effects) && otioTrack.effects.length > 0
        ? parseEffects(otioTrack.effects)
        : Array.isArray(trackFastCatMeta.effects)
          ? (trackFastCatMeta.effects as ClipEffect[])
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
    return m ? parseInt(m[1], 10) : null;
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
      : Array.isArray(fastcatMeta.markers)
        ? parseOtioMarkers(fastcatMeta.markers)
        : [];

  const playheadUs = fastcatMeta.playheadUs ? Math.round(fastcatMeta.playheadUs) : 0;
  const snapThresholdPx = fastcatMeta.snapThresholdPx
    ? Math.round(fastcatMeta.snapThresholdPx)
    : undefined;
  const zoom = fastcatMeta.zoom;
  const masterGain = fastcatMeta.masterGain;
  const masterMuted = fastcatMeta.masterMuted;
  const masterEffects = fastcatMeta.masterEffects;
  const trackHeights: Record<string, number> = fastcatMeta.trackHeights ?? {};

  const selectionRange =
    fastcatMeta.selectionRange?.startUs !== undefined &&
    fastcatMeta.selectionRange?.endUs !== undefined
      ? coerceSelectionRange({
          startUs: fastcatMeta.selectionRange.startUs,
          endUs: fastcatMeta.selectionRange.endUs,
        })
      : undefined;

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
        playheadUs,
        snapThresholdPx,
        zoom,
        masterGain,
        masterMuted,
        masterEffects,
        trackHeights,
        selectionRange,
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
        playheadUs,
        snapThresholdPx,
        zoom,
        masterGain,
        masterMuted,
        masterEffects,
        trackHeights,
        selectionRange,
      },
    },
  };
}
