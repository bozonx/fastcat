import type {
  TimelineClipItem,
  TimelineDocument,
  TimelineGapItem,
  TimelineRange,
  TimelineTimebase,
  TimelineTrack,
  TimelineTrackItem,
  TrackKind,
} from './types';

interface OtioRationalTime {
  OTIO_SCHEMA: 'RationalTime.1';
  value: number;
  rate: number;
}

interface OtioTimeRange {
  OTIO_SCHEMA: 'TimeRange.1';
  start_time: OtioRationalTime;
  duration: OtioRationalTime;
}

interface OtioExternalReference {
  OTIO_SCHEMA: 'ExternalReference.1';
  target_url: string;
}

interface OtioClip {
  OTIO_SCHEMA: 'Clip.1';
  name: string;
  media_reference: OtioExternalReference;
  source_range: OtioTimeRange;
  metadata?: Record<string, unknown>;
}

interface OtioGap {
  OTIO_SCHEMA: 'Gap.1';
  name: string;
  source_range: OtioTimeRange;
  metadata?: Record<string, unknown>;
}

interface OtioTrack {
  OTIO_SCHEMA: 'Track.1';
  name: string;
  kind: 'Video' | 'Audio';
  children: Array<OtioClip | OtioGap>;
  metadata?: Record<string, unknown>;
}

interface OtioStack {
  OTIO_SCHEMA: 'Stack.1';
  name: string;
  children: OtioTrack[];
}

interface OtioTimeline {
  OTIO_SCHEMA: 'Timeline.1';
  name: string;
  tracks: OtioStack;
  metadata?: Record<string, unknown>;
}

const TIME_RATE_US = 1_000_000;

function toRationalTimeUs(us: number): OtioRationalTime {
  return {
    OTIO_SCHEMA: 'RationalTime.1',
    value: Math.round(us),
    rate: TIME_RATE_US,
  };
}

function fromRationalTimeUs(rt: any): number {
  const value = Number(rt?.value);
  const rate = Number(rt?.rate);
  if (!Number.isFinite(value) || !Number.isFinite(rate) || rate <= 0) return 0;
  if (rate === TIME_RATE_US) return Math.round(value);
  return Math.round((value / rate) * TIME_RATE_US);
}

function toTimeRange(range: TimelineRange): OtioTimeRange {
  return {
    OTIO_SCHEMA: 'TimeRange.1',
    start_time: toRationalTimeUs(range.startUs),
    duration: toRationalTimeUs(range.durationUs),
  };
}

function fromTimeRange(tr: any): TimelineRange {
  return {
    startUs: fromRationalTimeUs(tr?.start_time),
    durationUs: fromRationalTimeUs(tr?.duration),
  };
}

function trackKindToOtioKind(kind: TrackKind): 'Video' | 'Audio' {
  return kind === 'audio' ? 'Audio' : 'Video';
}

function trackKindFromOtioKind(kind: any): TrackKind {
  return kind === 'Audio' ? 'audio' : 'video';
}

function assertTimelineTimebase(raw: any): TimelineTimebase {
  const fps = Number(raw?.fps);
  return {
    fps: Number.isFinite(fps) && fps > 0 ? Math.round(Math.min(240, Math.max(1, fps))) : 25,
  };
}

function coerceId(raw: any, fallback: string): string {
  const v = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
  return v;
}

function coerceName(raw: any, fallback: string): string {
  const v = typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
  return v;
}

function parseItemSequenceDurationUs(child: any): number {
  if (!child || typeof child !== 'object') return 0;
  if (child.OTIO_SCHEMA === 'Gap.1') {
    return Math.max(0, fromRationalTimeUs(child?.source_range?.duration));
  }
  if (child.OTIO_SCHEMA === 'Clip.1') {
    return Math.max(0, fromRationalTimeUs(child?.source_range?.duration));
  }
  return 0;
}

function safeGranMetadata(raw: any): any {
  if (!raw || typeof raw !== 'object') return {};
  const gran = (raw as any).gran;
  if (!gran || typeof gran !== 'object') return {};
  return gran;
}

function hashString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function buildFallbackItemId(input: {
  prefix: 'clip' | 'gap';
  trackId: string;
  fingerprint: string;
  occupiedIds: Set<string>;
}): string {
  const base = `${input.prefix}_${input.trackId}_${hashString(input.fingerprint)}`;
  if (!input.occupiedIds.has(base)) {
    input.occupiedIds.add(base);
    return base;
  }

  let suffix = 2;
  while (suffix < 10_000) {
    const candidate = `${base}_${suffix}`;
    if (!input.occupiedIds.has(candidate)) {
      input.occupiedIds.add(candidate);
      return candidate;
    }
    suffix += 1;
  }

  const emergency = `${base}_${Date.now()}`;
  input.occupiedIds.add(emergency);
  return emergency;
}

function resolveStableItemId(input: {
  prefix: 'clip' | 'gap';
  trackId: string;
  fallbackFingerprint: string;
  metadata: any;
  occupiedIds: Set<string>;
}): string {
  const metadataId = coerceId(input.metadata?.id, '');
  if (metadataId && !input.occupiedIds.has(metadataId)) {
    input.occupiedIds.add(metadataId);
    return metadataId;
  }

  return buildFallbackItemId({
    prefix: input.prefix,
    trackId: input.trackId,
    fingerprint: input.fallbackFingerprint,
    occupiedIds: input.occupiedIds,
  });
}

function parseClipItem(input: {
  trackId: string;
  otio: OtioClip;
  index: number;
  occupiedIds: Set<string>;
  fallbackStartUs: number;
}): TimelineClipItem {
  const { trackId, otio, index, occupiedIds, fallbackStartUs } = input;
  const sourceRange = fromTimeRange(otio.source_range);
  const name = coerceName(otio.name, `clip_${index + 1}`);
  const path =
    typeof otio.media_reference?.target_url === 'string' ? otio.media_reference.target_url : '';
  const granMeta = safeGranMetadata(otio.metadata);
  const clipTypeRaw = granMeta?.clipType;
  const clipType =
    clipTypeRaw === 'background' || clipTypeRaw === 'adjustment' || clipTypeRaw === 'media'
      ? clipTypeRaw
      : 'media';
  const timelineStartUs = fallbackStartUs;
  const sourceDurationUs = Math.max(0, Math.round(Number(granMeta?.sourceDurationUs ?? 0)));
  const id = resolveStableItemId({
    prefix: 'clip',
    trackId,
    fallbackFingerprint: JSON.stringify({
      path,
      sourceStartUs: sourceRange.startUs,
      sourceDurationUs: sourceRange.durationUs,
      timelineStartUs,
      name,
    }),
    metadata: granMeta,
    occupiedIds,
  });

  const base = {
    kind: 'clip' as const,
    clipType,
    id,
    trackId,
    name,
    sourceDurationUs: sourceDurationUs > 0 ? sourceDurationUs : sourceRange.durationUs,
    timelineRange: { startUs: timelineStartUs, durationUs: sourceRange.durationUs },
    sourceRange,
    audioFromVideoDisabled: Boolean(granMeta?.audioFromVideoDisabled),
    freezeFrameSourceUs:
      clipType === 'media' &&
      typeof granMeta?.freezeFrameSourceUs === 'number' &&
      Number.isFinite(granMeta.freezeFrameSourceUs)
        ? Math.max(0, Math.round(granMeta.freezeFrameSourceUs))
        : undefined,
    opacity:
      typeof granMeta?.opacity === 'number' && Number.isFinite(granMeta.opacity)
        ? Math.max(0, Math.min(1, granMeta.opacity))
        : undefined,
    effects: Array.isArray(granMeta?.effects) ? (granMeta.effects as any[]) : undefined,
    transitionIn:
      granMeta?.transitionIn &&
      typeof granMeta.transitionIn.type === 'string' &&
      typeof granMeta.transitionIn.durationUs === 'number'
        ? { type: granMeta.transitionIn.type, durationUs: Math.max(0, Math.round(granMeta.transitionIn.durationUs)) }
        : undefined,
    transitionOut:
      granMeta?.transitionOut &&
      typeof granMeta.transitionOut.type === 'string' &&
      typeof granMeta.transitionOut.durationUs === 'number'
        ? { type: granMeta.transitionOut.type, durationUs: Math.max(0, Math.round(granMeta.transitionOut.durationUs)) }
        : undefined,
    linkedVideoClipId:
      typeof granMeta?.linkedVideoClipId === 'string' &&
      granMeta.linkedVideoClipId.trim().length > 0
        ? granMeta.linkedVideoClipId
        : undefined,
    lockToLinkedVideo:
      granMeta?.lockToLinkedVideo !== undefined ? Boolean(granMeta.lockToLinkedVideo) : undefined,
  };

  if (clipType === 'background') {
    return {
      ...base,
      clipType: 'background',
      source: { path: path || '' },
      backgroundColor:
        typeof granMeta?.backgroundColor === 'string' && granMeta.backgroundColor.trim().length > 0
          ? granMeta.backgroundColor
          : '#000000',
    };
  }

  if (clipType === 'adjustment') {
    return { ...base, clipType: 'adjustment', source: { path: path || '' } };
  }

  return {
    ...base,
    clipType: 'media',
    source: { path },
  };
}

function parseGapItem(input: {
  trackId: string;
  otio: OtioGap;
  index: number;
  occupiedIds: Set<string>;
  fallbackStartUs: number;
}): TimelineGapItem {
  const { trackId, otio, index, occupiedIds, fallbackStartUs } = input;
  const range = fromTimeRange(otio.source_range);
  const granMeta = safeGranMetadata(otio.metadata);
  const timelineStartUs = fallbackStartUs;
  const id = resolveStableItemId({
    prefix: 'gap',
    trackId,
    fallbackFingerprint: JSON.stringify({
      durationUs: range.durationUs,
      timelineStartUs,
      index,
    }),
    metadata: granMeta,
    occupiedIds,
  });

  return {
    kind: 'gap',
    id,
    trackId,
    timelineRange: { startUs: timelineStartUs, durationUs: range.durationUs },
  };
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
      { id: 'v1', kind: 'video', name: 'Video 1', videoHidden: false, items: [] },
      { id: 'v2', kind: 'video', name: 'Video 2', videoHidden: false, items: [] },
      { id: 'a1', kind: 'audio', name: 'Audio 1', audioMuted: false, audioSolo: false, items: [] },
      { id: 'a2', kind: 'audio', name: 'Audio 2', audioMuted: false, audioSolo: false, items: [] },
    ],
  };
}

export function serializeTimelineToOtio(doc: TimelineDocument): string {
  const tracks: OtioTrack[] = doc.tracks.map((t) => {
    const sortedItems = [...t.items].sort(
      (a, b) => a.timelineRange.startUs - b.timelineRange.startUs,
    );
    const children: Array<OtioClip | OtioGap> = [];
    let cursorUs = 0;
    for (const item of sortedItems) {
      const startUs = Math.max(0, Math.round(item.timelineRange.startUs));
      const durationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

      if (startUs > cursorUs) {
        const gapDurationUs = startUs - cursorUs;
        children.push({
          OTIO_SCHEMA: 'Gap.1',
          name: 'gap',
          source_range: toTimeRange({ startUs: 0, durationUs: gapDurationUs }),
          metadata: {
            gran: {
              id: `gap_${t.id}_${cursorUs}`,
            },
          },
        });
        cursorUs = startUs;
      }

      if (item.kind === 'gap') {
        children.push({
          OTIO_SCHEMA: 'Gap.1',
          name: 'gap',
          source_range: toTimeRange({ startUs: 0, durationUs }),
          metadata: {
            gran: {
              id: item.id,
            },
          },
        });
        cursorUs += durationUs;
        continue;
      }

      children.push({
        OTIO_SCHEMA: 'Clip.1',
        name: item.name,
        media_reference: {
          OTIO_SCHEMA: 'ExternalReference.1',
          target_url: item.clipType === 'media' ? item.source.path : '',
        },
        source_range: toTimeRange(item.sourceRange),
        metadata: {
          gran: {
            id: item.id,
            clipType: item.clipType,
            sourceDurationUs: item.clipType === 'media' ? item.sourceDurationUs : undefined,
            audioFromVideoDisabled:
              item.clipType === 'media' ? Boolean(item.audioFromVideoDisabled) : undefined,
            freezeFrameSourceUs: item.clipType === 'media' ? item.freezeFrameSourceUs : undefined,
            opacity: item.opacity,
            effects: item.effects,
            transitionIn: item.transitionIn,
            transitionOut: item.transitionOut,
            linkedVideoClipId: item.clipType === 'media' ? item.linkedVideoClipId : undefined,
            lockToLinkedVideo: item.clipType === 'media' ? item.lockToLinkedVideo : undefined,
            backgroundColor:
              item.clipType === 'background' ? (item as any).backgroundColor : undefined,
          },
        },
      });
      cursorUs += durationUs;
    }

    return {
      OTIO_SCHEMA: 'Track.1',
      name: t.name,
      kind: trackKindToOtioKind(t.kind),
      children,
      metadata: {
        gran: {
          id: t.id,
          kind: t.kind,
          name: t.name,
          videoHidden: t.kind === 'video' ? Boolean(t.videoHidden) : undefined,
          audioMuted: Boolean(t.audioMuted),
          audioSolo: Boolean(t.audioSolo),
          effects: Array.isArray(t.effects) ? t.effects : undefined,
        },
      },
    };
  });

  const payload: OtioTimeline = {
    OTIO_SCHEMA: 'Timeline.1',
    name: doc.name,
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      name: 'tracks',
      children: tracks,
    },
    metadata: {
      gran: {
        docId: doc.id,
        timebase: doc.timebase,
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

  const granMeta = (parsed.metadata as any)?.gran;
  const timebase = assertTimelineTimebase(granMeta?.timebase ?? { fps: fallback.fps });

  const stackChildren = Array.isArray((parsed.tracks as any)?.children)
    ? (parsed.tracks as any).children
    : [];

  const tracks: TimelineTrack[] = stackChildren.map((otioTrack: OtioTrack, trackIndex: number) => {
    const trackGranMeta = safeGranMetadata(otioTrack.metadata);

    const id = coerceId(
      trackGranMeta?.id,
      `${otioTrack.kind === 'Audio' ? 'a' : 'v'}${trackIndex + 1}`,
    );
    const kind =
      trackGranMeta?.kind === 'audio' || trackGranMeta?.kind === 'video'
        ? trackGranMeta.kind
        : trackKindFromOtioKind(otioTrack.kind);
    const name = coerceName(
      trackGranMeta?.name ?? otioTrack.name,
      kind === 'audio' ? `Audio ${trackIndex + 1}` : `Video ${trackIndex + 1}`,
    );

    const children = Array.isArray(otioTrack.children) ? otioTrack.children : [];
    const occupiedIds = new Set<string>();
    let cursorUs = 0;

    const rawItems: TimelineTrackItem[] = children.map((child: any, itemIndex: number) => {
      const item =
        child?.OTIO_SCHEMA === 'Gap.1'
          ? parseGapItem({
              trackId: id,
              otio: child as OtioGap,
              index: itemIndex,
              occupiedIds,
              fallbackStartUs: cursorUs,
            })
          : parseClipItem({
              trackId: id,
              otio: child as OtioClip,
              index: itemIndex,
              occupiedIds,
              fallbackStartUs: cursorUs,
            });

      cursorUs += parseItemSequenceDurationUs(child);
      return item;
    });

    const items = [...rawItems].sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs);

    const videoHidden = kind === 'video' ? Boolean(trackGranMeta?.videoHidden) : undefined;
    const audioMuted = Boolean(trackGranMeta?.audioMuted);
    const audioSolo = Boolean(trackGranMeta?.audioSolo);
    const effects = Array.isArray(trackGranMeta?.effects)
      ? (trackGranMeta.effects as any[])
      : undefined;

    return { id, kind, name, videoHidden, audioMuted, audioSolo, effects, items };
  });

  const docId = coerceId(granMeta?.docId, fallback.id);
  const name = coerceName(parsed.name, fallback.name);

  if (tracks.length === 0) {
    return createDefaultTimelineDocument({ id: docId, name, fps: timebase.fps });
  }

  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: docId,
    name,
    timebase,
    tracks,
  };
}
