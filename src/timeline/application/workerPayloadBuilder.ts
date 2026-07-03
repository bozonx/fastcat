import { createDevLogger } from '~/utils/dev-logger';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import type { TimelineFormatInput } from '~/timeline/format';
import type {
  TimelineTrack,
  TimelineTrackItem,
  TimelineClipItem,
  TimelineSelectionRange,
  TimelineBlendMode,
  ClipEffect,
  TimelineDocument,
} from '~/timeline/types';
import { isClipItem } from '~/timeline/types';
import { mergeBalance, mergeGain } from '~/utils/audio/envelope';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import {
  cloneEffects,
  clonePlain,
  composeNestedTransform,
  mergeFadeInUs,
  mergeFadeOutUs,
  normalizeProjectPath,
  resolveNestedMediaPath,
} from '~/utils/video-editor/worker-clip-utils';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';
import { normalizeClipSpeed } from '~/utils/video-editor/source-time';
import { withFileIoSlot } from '~/utils/io/io-governor';
import type {
  WorkerTimelineClip,
  WorkerTrackPayloadSource,
  WorkerVideoPayloadItem,
  WorkerTimelineTrack,
  WorkerTimelineMeta,
} from '~/types/worker-payload';
const log = createDevLogger('payloadBuilder');

const MAX_NESTED_TIMELINE_DEPTH = 32;

export interface WorkerPayloadProjectContext {
  projectSettings: {
    project: TimelineFormatInput & {
      audioDeclickDurationUs?: number;
    };
  };
  getFileByPath: (path: string) => Promise<File | null>;
}

export interface WorkerPayloadWorkspaceContext {
  userSettings: {
    projectDefaults: {
      defaultAudioFadeCurve?: 'linear' | 'logarithmic';
    };
  };
}

export function buildWorkerVideoTracks(tracks: TimelineTrack[]): WorkerTrackPayloadSource[] {
  const visibleVideoTracks = tracks.filter((track) => track.kind === 'video' && !track.videoHidden);

  return visibleVideoTracks.map((track, index) => ({
    id: track.id,
    opacity: track.opacity,
    blendMode: track.blendMode,
    effects: track.effects,
    layer: visibleVideoTracks.length - 1 - index,
  }));
}

export function buildVideoWorkerPayload(input: {
  clips: WorkerTimelineClip[];
  tracks?: WorkerTrackPayloadSource[];
  masterEffects?: ClipEffect[];
}): WorkerVideoPayloadItem[] {
  const meta =
    Array.isArray(input.masterEffects) && input.masterEffects.length > 0
      ? ([
          { kind: 'meta', masterEffects: cloneEffects(input.masterEffects) },
        ] satisfies WorkerTimelineMeta[])
      : [];

  const tracks: WorkerTimelineTrack[] = (input.tracks ?? []).map((track) => ({
    kind: 'track',
    id: track.id,
    layer: track.layer,
    opacity: track.opacity,
    blendMode: track.blendMode,
    effects:
      Array.isArray(track.effects) && track.effects.length > 0
        ? clonePlain(track.effects)
        : undefined,
  }));

  return [...meta, ...tracks, ...input.clips];
}

interface BuildVideoPayloadFromTracksResult {
  clips: WorkerTimelineClip[];
  tracks: WorkerTrackPayloadSource[];
  payload: WorkerVideoPayloadItem[];
}

interface BuildVideoTrackTreeParams {
  tracks: TimelineTrack[];
  projectStore: WorkerPayloadProjectContext;
  workspaceStore: WorkerPayloadWorkspaceContext;
  layerOffset?: number;
  trackIdPrefix?: string;
  visitedPaths?: Set<string>;
  nestedPathStack?: string[];
  nestedTimelinePath?: string;
  inheritedTrackOpacity?: number;
  inheritedTrackBlendMode?: TimelineBlendMode;
  inheritedTrackEffects?: ClipEffect[];
  fallbackFormat?: TimelineFormatInput;
  onWarning?: (message: string) => void;
  nestedDocCache?: Map<string, TimelineDocument>;
  docSpanMemo?: Map<string, number>;
}

// Cross-request cache of parsed nested timeline docs, bounded with simple LRU
// eviction so a long editing session that touches many nested files can't grow
// memory without limit. Entries are keyed by normalized path and invalidated by
// the file's mtime.
const MAX_NESTED_DOC_CACHE_ENTRIES = 64;
const _nestedDocCache = new Map<string, { doc: TimelineDocument; mtime: number }>();

function getCachedNestedDoc(path: string, mtime: number): TimelineDocument | null {
  const cached = _nestedDocCache.get(path);
  if (!cached || cached.mtime !== mtime) return null;
  // Refresh recency: re-insert so the most-recently-used key is last.
  _nestedDocCache.delete(path);
  _nestedDocCache.set(path, cached);
  return cached.doc;
}

function setCachedNestedDoc(path: string, doc: TimelineDocument, mtime: number): void {
  _nestedDocCache.delete(path);
  _nestedDocCache.set(path, { doc, mtime });
  while (_nestedDocCache.size > MAX_NESTED_DOC_CACHE_ENTRIES) {
    const oldest = _nestedDocCache.keys().next().value;
    if (oldest === undefined) break;
    _nestedDocCache.delete(oldest);
  }
}

export function clearNestedDocCacheForTests(): void {
  _nestedDocCache.clear();
}

async function readNestedTimelineDoc(params: {
  path: string;
  projectStore: WorkerPayloadProjectContext;
  fallbackFormat?: TimelineFormatInput;
  cache?: Map<string, TimelineDocument>;
}): Promise<TimelineDocument | null> {
  const path = normalizeProjectPath(params.path);

  const requestCached = params.cache?.get(path);
  if (requestCached) {
    return requestCached;
  }

  const file = await params.projectStore.getFileByPath(path);
  if (!file) return null;

  const mtime = file.lastModified;
  const cachedDoc = getCachedNestedDoc(path, mtime);
  if (cachedDoc) {
    params.cache?.set(path, cachedDoc);
    return cachedDoc;
  }

  const text = await withFileIoSlot(() => file.text());
  const doc = parseTimelineFromOtio(text, {
    id: 'nested',
    name: path.split('/').pop() ?? 'nested',
    format: params.fallbackFormat ?? params.projectStore.projectSettings.project,
  });

  setCachedNestedDoc(path, doc, mtime);
  params.cache?.set(path, doc);
  return doc;
}

/**
 * Number of compositor layers a doc occupies once its nested timelines are
 * flattened — the sum of its visible video tracks' spans. Memoized per resolved
 * path: a doc's intrinsic span does not depend on the route taken to reach it,
 * and a self-referential cycle only ever *truncates* the span (the inner copy
 * is skipped), so the memoized full value is always >= the truncated one and
 * therefore never under-reserves.
 */
async function computeDocLayerSpan(params: {
  path: string;
  projectStore: WorkerPayloadProjectContext;
  visitedPaths: Set<string>;
  nestedDepth: number;
  fallbackFormat?: TimelineFormatInput;
  nestedDocCache: Map<string, TimelineDocument>;
  docSpanMemo: Map<string, number>;
}): Promise<number> {
  const memo = params.docSpanMemo.get(params.path);
  if (memo !== undefined) return memo;

  let total = 0;
  try {
    const doc = await readNestedTimelineDoc({
      path: params.path,
      projectStore: params.projectStore,
      fallbackFormat: params.fallbackFormat,
      cache: params.nestedDocCache,
    });
    if (!doc) {
      params.docSpanMemo.set(params.path, 1);
      return 1;
    }
    const videoTracks = doc.tracks.filter((t) => t.kind === 'video' && !t.videoHidden);
    for (const track of videoTracks) {
      total += await computeTrackLayerSpan({
        track,
        projectStore: params.projectStore,
        visitedPaths: params.visitedPaths,
        nestedDepth: params.nestedDepth,
        nestedTimelinePath: params.path,
        fallbackFormat: { fps: doc.timebase.fps },
        nestedDocCache: params.nestedDocCache,
        docSpanMemo: params.docSpanMemo,
      });
    }
  } catch {
    total = 1;
  }
  const span = Math.max(1, total);
  params.docSpanMemo.set(params.path, span);
  return span;
}

/**
 * Number of compositor layers a single track occupies once nested timelines are
 * flattened. A track with no nested-timeline clip is one layer; a track holding
 * a nested-timeline clip needs as many layers as the widest nested document it
 * contains expands to (recursively). Reserving this many layers lets sibling
 * tracks be assigned a non-overlapping layer band — without it a multi-video-
 * track nested timeline fans its inner tracks *upward* into the layer values of
 * the tracks above, so z-ordering and adjustment clips above the nested clip
 * become unreliable.
 */
async function computeTrackLayerSpan(params: {
  track: TimelineTrack;
  projectStore: WorkerPayloadProjectContext;
  visitedPaths: Set<string>;
  nestedDepth: number;
  nestedTimelinePath?: string;
  fallbackFormat?: TimelineFormatInput;
  nestedDocCache: Map<string, TimelineDocument>;
  docSpanMemo: Map<string, number>;
}): Promise<number> {
  let span = 1;
  for (const item of params.track.items) {
    if (!isClipItem(item) || item.disabled) continue;
    if (item.clipType !== 'timeline') continue;
    const rawPath = item.source?.path;
    if (!rawPath) continue;
    const path = params.nestedTimelinePath
      ? resolveNestedMediaPath({
          nestedTimelinePath: params.nestedTimelinePath,
          mediaPath: rawPath,
        })
      : normalizeProjectPath(rawPath);
    // A circular or too-deep reference expands to nothing, so it needs no extra
    // layers beyond the track's own one.
    if (params.visitedPaths.has(path)) continue;
    if (params.nestedDepth >= MAX_NESTED_TIMELINE_DEPTH) continue;

    const docSpan = await computeDocLayerSpan({
      path,
      projectStore: params.projectStore,
      visitedPaths: new Set(params.visitedPaths).add(path),
      nestedDepth: params.nestedDepth + 1,
      fallbackFormat: params.fallbackFormat,
      nestedDocCache: params.nestedDocCache,
      docSpanMemo: params.docSpanMemo,
    });
    span = Math.max(span, docSpan);
  }
  return span;
}

/**
 * Assigns each track in document order (index 0 = topmost) a base layer such
 * that the tracks form contiguous, non-overlapping layer bands stacked
 * bottom-to-top. Each band is as wide as the track's flattened layer span so a
 * nested timeline can fan its inner tracks out inside its own band without
 * colliding with sibling tracks above it.
 */
export function assignLayerBands(spans: number[], baseLayerOffset: number): number[] {
  const bases = new Array<number>(spans.length);
  let cursor = baseLayerOffset;
  for (let index = spans.length - 1; index >= 0; index--) {
    bases[index] = cursor;
    cursor += spans[index] ?? 1;
  }
  return bases;
}

async function buildVideoTrackTree(
  params: BuildVideoTrackTreeParams,
): Promise<{ clips: WorkerTimelineClip[]; tracks: WorkerTrackPayloadSource[] }> {
  const result: { clips: WorkerTimelineClip[]; tracks: WorkerTrackPayloadSource[] } = {
    clips: [],
    tracks: [],
  };

  const visibleTracks = params.tracks.filter(
    (track) => track.kind === 'video' && !track.videoHidden,
  );
  const baseLayerOffset = params.layerOffset ?? 0;
  const inheritedTrackOpacity = params.inheritedTrackOpacity ?? 1;
  const inheritedTrackEffects = params.inheritedTrackEffects ?? [];
  const visitedPaths = params.visitedPaths ?? new Set<string>();
  const nestedPathStack = params.nestedPathStack ?? [];
  const nestedDocCache = params.nestedDocCache ?? new Map<string, TimelineDocument>();
  const docSpanMemo = params.docSpanMemo ?? new Map<string, number>();

  // Reserve a layer band per track wide enough for the nested timelines it
  // contains, so a multi-video-track nested clip never fans its inner tracks
  // into the layer values of the sibling tracks above it.
  const trackSpans = await Promise.all(
    visibleTracks.map((track) =>
      computeTrackLayerSpan({
        track,
        projectStore: params.projectStore,
        visitedPaths,
        nestedDepth: nestedPathStack.length,
        nestedTimelinePath: params.nestedTimelinePath,
        fallbackFormat: params.fallbackFormat,
        nestedDocCache,
        docSpanMemo,
      }),
    ),
  );
  const trackLayerBases = assignLayerBands(trackSpans, baseLayerOffset);

  for (let index = 0; index < visibleTracks.length; index++) {
    const track = visibleTracks[index];
    if (!track) continue;

    const layer = trackLayerBases[index] ?? baseLayerOffset;
    const runtimeTrackId = params.trackIdPrefix ? `${params.trackIdPrefix}::${track.id}` : track.id;
    const trackOpacity = inheritedTrackOpacity * (track.opacity ?? 1);
    const trackBlendMode = track.blendMode ?? params.inheritedTrackBlendMode;
    const localTrackEffects = Array.isArray(track.effects) ? cloneEffects(track.effects) : [];
    const trackEffects =
      inheritedTrackEffects.length > 0
        ? [...localTrackEffects, ...inheritedTrackEffects]
        : localTrackEffects;

    result.tracks.push({
      id: runtimeTrackId,
      layer,
      opacity: trackOpacity,
      blendMode: trackBlendMode,
      effects: trackEffects.length > 0 ? trackEffects : undefined,
    });

    const trackClips = await toWorkerTimelineClips(
      track.items,
      params.projectStore,
      params.workspaceStore,
      {
        layer,
        trackKind: 'video',
        visitedPaths,
        nestedPathStack,
        parentOpacity: inheritedTrackOpacity,
        parentBlendMode: params.inheritedTrackBlendMode,
        parentEffects: inheritedTrackEffects,
        nestedParentOpacity: trackOpacity,
        nestedParentBlendMode: trackBlendMode,
        nestedParentEffects: trackEffects,
        fallbackFormat: params.fallbackFormat,
        onWarning: params.onWarning,
        nestedTimelinePath: params.nestedTimelinePath,
        nestedDocCache,
        docSpanMemo,
        trackIdPrefix: params.trackIdPrefix ? `${params.trackIdPrefix}::` : undefined,
        onTrackBuilt: (builtTrack) => {
          result.tracks.push(builtTrack);
        },
      },
    );

    result.clips.push(...trackClips);
  }

  return result;
}

export async function buildVideoWorkerPayloadFromTracks(input: {
  tracks: TimelineTrack[];
  projectStore: WorkerPayloadProjectContext;
  workspaceStore: WorkerPayloadWorkspaceContext;
  masterEffects?: ClipEffect[];
  fallbackFormat?: TimelineFormatInput;
  onWarning?: (message: string) => void;
  nestedDocCache?: Map<string, TimelineDocument>;
}): Promise<BuildVideoPayloadFromTracksResult> {
  const result = await buildVideoTrackTree({
    tracks: input.tracks,
    projectStore: input.projectStore,
    workspaceStore: input.workspaceStore,
    fallbackFormat: input.fallbackFormat ?? input.projectStore.projectSettings.project,
    onWarning: input.onWarning,
    nestedDocCache: input.nestedDocCache,
  });

  return {
    clips: result.clips,
    tracks: result.tracks,
    payload: buildVideoWorkerPayload({
      clips: result.clips,
      tracks: result.tracks,
      masterEffects: input.masterEffects,
    }),
  };
}

export function trimWorkerClipToRange(
  clip: WorkerTimelineClip,
  range: TimelineSelectionRange,
): WorkerTimelineClip | null {
  const clipStartUs = clip.timelineRange.startUs;
  const clipEndUs = clip.timelineRange.startUs + clip.timelineRange.durationUs;
  const overlapStartUs = Math.max(clipStartUs, range.startUs);
  const overlapEndUs = Math.min(clipEndUs, range.endUs);

  if (overlapEndUs <= overlapStartUs) return null;

  const trimStartUs = overlapStartUs - clipStartUs;
  const trimEndUs = clipEndUs - overlapEndUs;
  const trimmedDurationUs = overlapEndUs - overlapStartUs;
  const speedRaw = normalizeClipSpeed(clip.speed);
  const speed = Math.abs(speedRaw);
  const isReversed = speedRaw < 0;
  const sourceTrimStartUs = Math.round((isReversed ? trimEndUs : trimStartUs) * speed);
  const sourceDurationUs = Math.round(trimmedDurationUs * speed);

  return {
    ...clip,
    audioFadeInUs:
      typeof clip.audioFadeInUs === 'number'
        ? Math.max(0, Math.round(clip.audioFadeInUs - trimStartUs))
        : clip.audioFadeInUs,
    audioFadeOutUs:
      typeof clip.audioFadeOutUs === 'number'
        ? Math.max(0, Math.round(clip.audioFadeOutUs - trimEndUs))
        : clip.audioFadeOutUs,
    timelineRange: {
      startUs: overlapStartUs - range.startUs,
      durationUs: trimmedDurationUs,
    },
    sourceRange: {
      startUs: clip.sourceRange.startUs + sourceTrimStartUs,
      durationUs: sourceDurationUs,
    },
  };
}

function getTimelinePlaybackSpeed(raw: number | undefined): number {
  if (raw === undefined || !Number.isFinite(raw) || raw === 0) return 1;
  return raw;
}

interface NestedClipWindow {
  overlapStartUs: number;
  overlapEndUs: number;
  parentStartUs: number;
  parentDurationUs: number;
  parentLocalStartUs: number;
  parentLocalEndUs: number;
}

export function getNestedClipWindow(params: {
  nestedClip: WorkerTimelineClip;
  parentItem: TimelineClipItem;
}): NestedClipWindow | null {
  const { nestedClip, parentItem } = params;
  const parentSpeedRaw = getTimelinePlaybackSpeed(parentItem.speed);
  const parentSpeed = Math.abs(parentSpeedRaw);
  const isReversed = parentSpeedRaw < 0;
  const nestedStartUs = nestedClip.timelineRange.startUs;
  const nestedEndUs = nestedStartUs + nestedClip.timelineRange.durationUs;
  const parentSourceRange = parentItem.sourceRange;
  const windowStartUs = parentSourceRange.startUs;
  const windowEndUs = windowStartUs + parentSourceRange.durationUs;
  const overlapStartUs = Math.max(nestedStartUs, windowStartUs);
  const overlapEndUs = Math.min(nestedEndUs, windowEndUs);

  if (overlapStartUs >= overlapEndUs) return null;

  const visibleDurationUs = overlapEndUs - overlapStartUs;
  const parentDurationUs = Math.max(1, Math.round(visibleDurationUs / parentSpeed));
  const parentOffsetUs = isReversed
    ? Math.round((windowEndUs - overlapEndUs) / parentSpeed)
    : Math.round((overlapStartUs - windowStartUs) / parentSpeed);
  const parentLocalStartUs = Math.max(0, parentOffsetUs);

  return {
    overlapStartUs,
    overlapEndUs,
    parentStartUs: parentItem.timelineRange.startUs + parentLocalStartUs,
    parentDurationUs,
    parentLocalStartUs,
    parentLocalEndUs: parentLocalStartUs + parentDurationUs,
  };
}

export function mergeNestedClipSpeed(params: {
  parentItem: TimelineClipItem;
  nestedClip: WorkerTimelineClip;
}): number | undefined {
  const parentSpeedRaw = getTimelinePlaybackSpeed(params.parentItem.speed);
  const nestedSpeedRaw = getTimelinePlaybackSpeed(params.nestedClip.speed);
  const combined = parentSpeedRaw * nestedSpeedRaw;
  return combined === 1 && params.nestedClip.speed === undefined ? undefined : combined;
}

export function trimNestedClipToParentWindow(params: {
  nestedClip: WorkerTimelineClip;
  parentItem: TimelineClipItem;
}): WorkerTimelineClip | null {
  const clipWindow = getNestedClipWindow(params);
  if (!clipWindow) return null;

  const trimmed = trimWorkerClipToRange(params.nestedClip, {
    startUs: clipWindow.overlapStartUs,
    endUs: clipWindow.overlapEndUs,
  });
  if (!trimmed) return null;

  return {
    ...trimmed,
    speed: mergeNestedClipSpeed(params),
    timelineRange: {
      startUs: clipWindow.parentStartUs,
      durationUs: clipWindow.parentDurationUs,
    },
  };
}

type ToWorkerTimelineClipsOptions = {
  layer?: number;
  trackKind?: 'video' | 'audio';
  visitedPaths?: Set<string>;
  nestedPathStack?: string[];
  parentOpacity?: number;
  parentBlendMode?: TimelineBlendMode;
  parentEffects?: ClipEffect[];
  nestedParentOpacity?: number;
  nestedParentBlendMode?: TimelineBlendMode;
  nestedParentEffects?: ClipEffect[];
  parentAudioGain?: number;
  parentAudioBalance?: number;
  fallbackFormat?: TimelineFormatInput;
  onWarning?: (message: string) => void;
  nestedTimelinePath?: string;
  nestedDocCache?: Map<string, TimelineDocument>;
  docSpanMemo?: Map<string, number>;
  trackIdPrefix?: string;
  onTrackBuilt?: (track: WorkerTrackPayloadSource) => void;
};

function cloneEffectList(effects: ClipEffect[] | undefined): ClipEffect[] {
  return Array.isArray(effects) ? cloneEffects(effects) : [];
}

/**
 * The worker scene has no `timeline` clip kind: a nested-timeline clip is
 * expanded into its inner clips, and any residual reference degrades to media.
 */
function toWorkerClipType(
  clipType: 'timeline' | WorkerTimelineClip['clipType'],
): WorkerTimelineClip['clipType'] {
  return clipType === 'timeline' ? 'media' : clipType;
}

/** Re-roots a nested media clip's source path relative to its nested doc. */
function resolveNestedMediaClipPath(
  nClip: WorkerTimelineClip,
  nestedTimelinePath: string,
): WorkerTimelineClip {
  if (nClip.clipType !== 'media' || !nClip.source?.path) return nClip;
  return {
    ...nClip,
    source: {
      path: resolveNestedMediaPath({ nestedTimelinePath, mediaPath: nClip.source.path }),
    },
  };
}

/**
 * Windows every produced inner clip to the parent clip's range, merges the
 * parent fades, and rewrites identity (id/trackId/layer). Shared by the video
 * and audio expansion paths — the only differences are the layer, how the
 * track id is composed, and (audio only) that the orphaned inner layer carries
 * the fully-merged gain/balance as its `original*` value (see comment below).
 */
function finalizeNestedClips(params: {
  nestedWorkerClips: WorkerTimelineClip[];
  item: TimelineClipItem;
  nestedTimelinePath: string;
  mode: 'video' | 'audio';
  layer: number;
}): WorkerTimelineClip[] {
  const { nestedWorkerClips, item, nestedTimelinePath, mode, layer } = params;
  const out: WorkerTimelineClip[] = [];
  const parentDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

  // The parent nested-timeline clip's transform / orientation / transitions must
  // be applied to its expanded inner clips so the block behaves like a regular
  // video clip (transform composes onto every inner layer; an entry/exit
  // transition fades the inner layers visible at the parent's edges — a
  // cross-dissolve with a neighbour is not representable while flattened).
  const parentTransform = item.transformActive !== false ? item.transform : undefined;
  const parentOrientation = item.transformActive !== false ? item.sourceOrientation : undefined;
  const parentStartUs = item.timelineRange.startUs;
  const parentEndUs = parentStartUs + item.timelineRange.durationUs;
  const parentTransitionIn = item.transitionIn;
  const parentTransitionOut = item.transitionOut;
  const transitionInEndUs = parentStartUs + (parentTransitionIn?.durationUs ?? 0);
  const transitionOutStartUs = parentEndUs - (parentTransitionOut?.durationUs ?? 0);

  for (const nClip of nestedWorkerClips) {
    const resolvedNClip = resolveNestedMediaClipPath(nClip, nestedTimelinePath);
    const clipWindow = getNestedClipWindow({ nestedClip: resolvedNClip, parentItem: item });
    const trimmedNestedClip = trimNestedClipToParentWindow({
      nestedClip: resolvedNClip,
      parentItem: item,
    });
    if (!clipWindow || !trimmedNestedClip) continue;

    const isVideo = mode === 'video';
    const composedTransform = isVideo
      ? composeNestedTransform({
          parent: parentTransform,
          parentOrientation,
          child: trimmedNestedClip.transform,
        })
      : trimmedNestedClip.transform;

    // Apply the parent transition to inner clips touching the parent's edge.
    // Keep an inner clip's own transition when present (it owns that edge).
    const clipStartUs = trimmedNestedClip.timelineRange.startUs;
    const clipEndUs = clipStartUs + trimmedNestedClip.timelineRange.durationUs;
    const transitionIn =
      isVideo && parentTransitionIn && clipStartUs < transitionInEndUs
        ? (trimmedNestedClip.transitionIn ?? clonePlain(parentTransitionIn))
        : trimmedNestedClip.transitionIn;
    const transitionOut =
      isVideo && parentTransitionOut && clipEndUs > transitionOutStartUs
        ? (trimmedNestedClip.transitionOut ?? clonePlain(parentTransitionOut))
        : trimmedNestedClip.transitionOut;

    out.push({
      ...trimmedNestedClip,
      id: `${item.id}_nested_${resolvedNClip.id}`,
      layer,
      transform: composedTransform,
      transitionIn,
      transitionOut,
      trackId:
        mode === 'video'
          ? resolvedNClip.trackId
            ? `${item.trackId}::${item.id}::${resolvedNClip.trackId}`
            : undefined
          : resolvedNClip.trackId,
      audioGain: resolvedNClip.audioGain,
      audioBalance: resolvedNClip.audioBalance,
      // A nested audio clip's track_id is the *inner* doc's track, which has no
      // matching native bus (the scene only exposes outer-doc tracks), so the
      // layer is mixed straight into master as an orphan. It must therefore
      // carry the full merged gain/balance — not the clip-only value — since no
      // bus will re-apply the (already-merged) track stage.
      ...(mode === 'audio'
        ? {
            originalAudioGain: resolvedNClip.audioGain,
            originalAudioBalance: resolvedNClip.audioBalance,
          }
        : null),
      audioFadeInUs: mergeFadeInUs({
        childFadeInUs: resolvedNClip.audioFadeInUs,
        parentFadeInUs: item.audioFadeInUs,
        parentLocalStartUs: clipWindow.parentLocalStartUs,
      }),
      audioFadeOutUs: mergeFadeOutUs({
        childFadeOutUs: resolvedNClip.audioFadeOutUs,
        parentFadeOutUs: item.audioFadeOutUs,
        parentLocalEndUs: clipWindow.parentLocalEndUs,
        parentDurationUs,
      }),
      audioFadeInCurve: resolvedNClip.audioFadeInCurve ?? item.audioFadeInCurve,
      audioFadeOutCurve: resolvedNClip.audioFadeOutCurve ?? item.audioFadeOutCurve,
    });
  }

  return out;
}

/**
 * Builds the clip-type-agnostic fields every worker clip shares. Type-specific
 * fields (source/text/shape/hud/background) are added by the callers so the
 * discriminated union stays clean.
 */
function buildBaseWorkerClip(params: {
  item: TimelineClipItem;
  clipType: 'timeline' | WorkerTimelineClip['clipType'];
  layer: number;
  combinedOpacity: number;
  combinedBlendMode: TimelineBlendMode | undefined;
  combinedEffects: ClipEffect[];
  parentAudioGain: number;
  parentAudioBalance: number;
  projectStore: WorkerPayloadProjectContext;
  workspaceStore: WorkerPayloadWorkspaceContext;
}): WorkerTimelineClip {
  const { item, projectStore, workspaceStore } = params;
  return {
    kind: 'clip',
    clipType: toWorkerClipType(params.clipType),
    id: item.id,
    trackId: item.trackId,
    layer: params.layer,
    speed: item.speedActive !== false ? item.speed : undefined,
    audioGain: mergeGain(params.parentAudioGain, item.audioGain),
    audioBalance: mergeBalance(params.parentAudioBalance, item.audioBalance),
    // Clip-only gain/balance (track bus excluded). The native mixer applies the
    // owning track's gain/balance separately on its bus, so the layer must not
    // also carry it — otherwise track gain/balance is applied twice. The
    // `audioGain`/`audioBalance` above are the merged track×clip value the web
    // mixer needs; the originals are the clip's own value.
    originalAudioGain: mergeGain(params.parentAudioGain, item.originalAudioGain),
    originalAudioBalance: mergeBalance(params.parentAudioBalance, item.originalAudioBalance),
    audioFadeInUs: item.audioFadesActive !== false ? item.audioFadeInUs : undefined,
    audioFadeOutUs: item.audioFadesActive !== false ? item.audioFadeOutUs : undefined,
    audioFadeInCurve: item.audioFadesActive !== false ? item.audioFadeInCurve : undefined,
    audioFadeOutCurve: item.audioFadesActive !== false ? item.audioFadeOutCurve : undefined,
    audioDeclickDurationUs: projectStore.projectSettings.project.audioDeclickDurationUs,
    defaultAudioFadeCurve: workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve,
    opacity: item.opacityActive !== false ? params.combinedOpacity : undefined,
    blendMode: item.blendModeActive !== false ? params.combinedBlendMode : undefined,
    effects: params.combinedEffects.length > 0 ? params.combinedEffects : undefined,
    mask: item.maskActive !== false ? clonePlain(item.mask) : undefined,
    transform: item.transformActive !== false ? clonePlain(item.transform) : undefined,
    sourceOrientation: item.transformActive !== false ? item.sourceOrientation : undefined,
    transitionIn: clonePlain(item.transitionIn),
    transitionOut: clonePlain(item.transitionOut),
    sourceDurationUs: typeof item.sourceDurationUs === 'number' ? item.sourceDurationUs : undefined,
    snapToPixelGrid: item.snapToPixelGrid,
    timelineRange: {
      startUs: item.timelineRange.startUs,
      durationUs: item.timelineRange.durationUs,
    },
    sourceRange: {
      startUs: item.sourceRange.startUs,
      durationUs: item.sourceRange.durationUs,
    },
  };
}

/** Adds the type-specific fields for non-media clip kinds onto a base clip. */
function buildTypedWorkerClip(
  base: WorkerTimelineClip,
  item: TimelineClipItem,
  clipType: WorkerTimelineClip['clipType'],
): WorkerTimelineClip {
  if (clipType === 'background') {
    return { ...base, backgroundColor: sanitizeTimelineColor(item.backgroundColor, '#000000') };
  }
  if (clipType === 'text') {
    return { ...base, text: String(item.text ?? ''), style: clonePlain(item.style) };
  }
  if (clipType === 'shape') {
    return {
      ...base,
      shapeType: item.shapeType ?? 'square',
      fillColor: typeof item.fillColor === 'string' ? item.fillColor : undefined,
      strokeColor: typeof item.strokeColor === 'string' ? item.strokeColor : undefined,
      strokeWidth: typeof item.strokeWidth === 'number' ? item.strokeWidth : undefined,
      shapeConfig: clonePlain(item.shapeConfig),
    };
  }
  if (clipType === 'hud') {
    return {
      ...base,
      hudType: item.hudType ?? 'media_frame',
      background: clonePlain(item.background),
      content: clonePlain(item.content),
      frame: clonePlain(item.frame),
    };
  }
  return base;
}

/**
 * Expands a `clipType: 'timeline'` clip into the flattened worker clips that
 * represent its inner document. Recurses through {@link toWorkerTimelineClips}
 * for each inner track (video) or the effective audio item set (audio), then
 * windows/trims every produced clip to the parent clip's timeline range and
 * merges parent fades. Returns the clips to push; an empty array means the
 * nested doc was missing (the caller skips the clip). Throws are propagated so
 * the caller can warn and fall back to a plain clip.
 */
async function expandNestedTimeline(params: {
  item: TimelineClipItem;
  path: string;
  trackKind: 'video' | 'audio';
  visitedPaths: Set<string>;
  nestedPathStack: string[];
  nestedDocCache: Map<string, TimelineDocument>;
  combinedOpacity: number;
  combinedBlendMode: TimelineBlendMode | undefined;
  combinedEffects: ClipEffect[];
  parentAudioGain: number;
  parentAudioBalance: number;
  projectStore: WorkerPayloadProjectContext;
  workspaceStore: WorkerPayloadWorkspaceContext;
  options: ToWorkerTimelineClipsOptions | undefined;
}): Promise<WorkerTimelineClip[]> {
  const {
    item,
    path,
    trackKind,
    visitedPaths,
    nestedPathStack,
    nestedDocCache,
    combinedOpacity,
    combinedBlendMode,
    combinedEffects,
    parentAudioGain,
    parentAudioBalance,
    projectStore,
    workspaceStore,
    options,
  } = params;

  const out: WorkerTimelineClip[] = [];

  const nestedDoc = await readNestedTimelineDoc({
    path,
    projectStore,
    fallbackFormat: options?.fallbackFormat,
    cache: nestedDocCache,
  });
  if (!nestedDoc) {
    log.warn(`Nested timeline file not found: ${path}`);
    return out;
  }

  const nextVisited = new Set(visitedPaths).add(path);
  const nextNestedPathStack = [...nestedPathStack, path];

  const docSpanMemo = options?.docSpanMemo ?? new Map<string, number>();

  if (trackKind === 'video') {
    const nestedVideoTracks = nestedDoc.tracks.filter((t) => t.kind === 'video' && !t.videoHidden);
    // Lay the inner tracks out as contiguous layer bands inside the band this
    // nested clip was reserved on (base = options.layer), each band wide enough
    // for its own deeper nesting. The band sum equals this clip's reserved span,
    // so the inner layers never spill onto the sibling tracks above.
    const nestedSpans = await Promise.all(
      nestedVideoTracks.map((track) =>
        computeTrackLayerSpan({
          track,
          projectStore,
          visitedPaths: nextVisited,
          nestedDepth: nextNestedPathStack.length,
          nestedTimelinePath: path,
          fallbackFormat: { fps: nestedDoc.timebase.fps },
          nestedDocCache,
          docSpanMemo,
        }),
      ),
    );
    const nestedLayerBases = assignLayerBands(nestedSpans, options?.layer ?? 0);

    for (let i = 0; i < nestedVideoTracks.length; i++) {
      const track = nestedVideoTracks[i];
      if (!track) continue;
      const nestedLayer = nestedLayerBases[i] ?? options?.layer ?? 0;

      const trackEffects = cloneEffectList(track.effects);
      const inheritedNestedEffects = options?.nestedParentEffects ?? [];
      const combinedTrackEffects =
        combinedEffects.length > 0 || inheritedNestedEffects.length > 0
          ? [...trackEffects, ...combinedEffects, ...inheritedNestedEffects]
          : trackEffects;
      const nestedTrackOpacity =
        (options?.nestedParentOpacity ?? 1) * combinedOpacity * (track.opacity ?? 1);
      const nestedTrackBlendMode =
        track.blendMode ?? combinedBlendMode ?? options?.nestedParentBlendMode;

      const nextTrackIdPrefix = `${options?.trackIdPrefix ?? ''}${item.trackId}::${item.id}::`;
      const nestedTrackId = `${nextTrackIdPrefix}${track.id}`;

      if (options?.onTrackBuilt) {
        options.onTrackBuilt({
          id: nestedTrackId,
          layer: nestedLayer,
          opacity: nestedTrackOpacity,
          blendMode: nestedTrackBlendMode,
          effects: combinedTrackEffects.length > 0 ? combinedTrackEffects : undefined,
        });
      }

      const nestedWorkerClips = await toWorkerTimelineClips(
        track.items,
        projectStore,
        workspaceStore,
        {
          layer: nestedLayer,
          trackKind: 'video',
          visitedPaths: nextVisited,
          nestedPathStack: nextNestedPathStack,
          parentOpacity: 1,
          parentBlendMode: undefined,
          parentEffects: undefined,
          nestedParentOpacity: nestedTrackOpacity,
          nestedParentBlendMode: nestedTrackBlendMode,
          nestedParentEffects: combinedTrackEffects,
          fallbackFormat: { fps: nestedDoc.timebase.fps },
          onWarning: options?.onWarning,
          nestedTimelinePath: path,
          nestedDocCache,
          docSpanMemo,
          trackIdPrefix: nextTrackIdPrefix,
          onTrackBuilt: options?.onTrackBuilt,
        },
      );

      out.push(
        ...finalizeNestedClips({
          nestedWorkerClips,
          item,
          nestedTimelinePath: path,
          mode: 'video',
          layer: nestedLayer,
        }),
      );
    }
  } else if (trackKind === 'audio') {
    const nestedAudioResult = buildEffectiveAudioClipItems({
      audioTracks: nestedDoc.tracks.filter((t) => t.kind === 'audio'),
      videoTracks: nestedDoc.tracks.filter((t) => t.kind === 'video'),
    });

    const nestedWorkerClips = await toWorkerTimelineClips(
      nestedAudioResult.items,
      projectStore,
      workspaceStore,
      {
        layer: 0,
        trackKind: 'audio',
        visitedPaths: nextVisited,
        nestedPathStack: nextNestedPathStack,
        parentOpacity: combinedOpacity,
        parentBlendMode: combinedBlendMode,
        parentEffects: combinedEffects,
        parentAudioGain: mergeGain(parentAudioGain, item.audioGain),
        parentAudioBalance: mergeBalance(parentAudioBalance, item.audioBalance),
        onWarning: options?.onWarning,
        nestedTimelinePath: path,
        nestedDocCache,
        docSpanMemo,
      },
    );

    out.push(
      ...finalizeNestedClips({
        nestedWorkerClips,
        item,
        nestedTimelinePath: path,
        mode: 'audio',
        layer: 0,
      }),
    );
  }

  return out;
}

export async function toWorkerTimelineClips(
  items: TimelineTrackItem[],
  projectStore: WorkerPayloadProjectContext,
  workspaceStore: WorkerPayloadWorkspaceContext,
  options?: ToWorkerTimelineClipsOptions,
): Promise<WorkerTimelineClip[]> {
  const clips: WorkerTimelineClip[] = [];
  const trackKind = options?.trackKind ?? 'video';
  const visitedPaths = options?.visitedPaths ?? new Set<string>();
  const nestedPathStack = options?.nestedPathStack ?? [];
  const nestedDocCache = options?.nestedDocCache ?? new Map<string, TimelineDocument>();

  for (const item of items) {
    if (!isClipItem(item)) continue;
    if (item.disabled) continue;

    const clipType = item.clipType ?? 'media';
    const parentOpacity = options?.parentOpacity ?? 1;
    const itemOpacity = item.opacity ?? 1;
    const combinedOpacity = parentOpacity * itemOpacity;
    const combinedBlendMode = item.blendMode ?? options?.parentBlendMode;

    // Track-level effects are applied to the track container by the compositor;
    // merging them into every clip would cause double-application.
    const combinedEffects = cloneEffectList(item.effects);

    const parentAudioBalance = options?.parentAudioBalance ?? 0;
    const parentAudioGain = options?.parentAudioGain ?? 1;

    const layer =
      options?.layer ??
      (typeof item.layer === 'number' && Number.isFinite(item.layer) ? Math.round(item.layer) : 0);

    const base = buildBaseWorkerClip({
      item,
      clipType,
      layer,
      combinedOpacity,
      combinedBlendMode,
      combinedEffects,
      parentAudioGain,
      parentAudioBalance,
      projectStore,
      workspaceStore,
    });

    if (clipType === 'media' || clipType === 'timeline') {
      const rawPath = item.source?.path;
      if (!rawPath) continue;
      const path =
        clipType === 'timeline' && options?.nestedTimelinePath
          ? resolveNestedMediaPath({
              nestedTimelinePath: options.nestedTimelinePath,
              mediaPath: rawPath,
            })
          : normalizeProjectPath(rawPath);

      if (clipType === 'timeline') {
        if (visitedPaths.has(path)) {
          log.warn(
            `Circular dependency in nested timeline: ${[...nestedPathStack, path].join(' -> ')}`,
          );
          continue;
        }

        if (nestedPathStack.length >= MAX_NESTED_TIMELINE_DEPTH) {
          log.warn(
            `Nested timeline depth limit reached at ${[...nestedPathStack, path].join(' -> ')}`,
          );
          continue;
        }

        try {
          const nestedClips = await expandNestedTimeline({
            item,
            path,
            trackKind,
            visitedPaths,
            nestedPathStack,
            nestedDocCache,
            combinedOpacity,
            combinedBlendMode,
            combinedEffects,
            parentAudioGain,
            parentAudioBalance,
            projectStore,
            workspaceStore,
            options,
          });
          for (const nestedClip of nestedClips) {
            clips.push(nestedClip);
          }
          continue;
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          const message = `Failed to expand nested timeline "${path}": ${reason}`;
          log.error(message, e);
          options?.onWarning?.(message);
        }
      }

      clips.push({
        ...base,
        source: { path },
        freezeFrameSourceUs: item.freezeFrameSourceUs,
      });
    } else {
      clips.push(buildTypedWorkerClip(base, item, base.clipType));
    }
  }
  return clips;
}
