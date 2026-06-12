import { createDevLogger } from '~/utils/dev-logger';
import type { useProjectStore } from '~/stores/project.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import { parseTimelineFromOtio } from '~/timeline/otio-serializer';
import type { TimelineFormatInput } from '~/timeline/format';
import type {
  TimelineTrack,
  TimelineTrackItem,
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
} from './types';
const log = createDevLogger('payloadBuilder');

const MAX_NESTED_TIMELINE_DEPTH = 32;

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
  projectStore: ReturnType<typeof useProjectStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
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
}

const _nestedDocCache = new Map<string, { doc: TimelineDocument; mtime: number }>();

export function clearNestedDocCacheForTests(): void {
  _nestedDocCache.clear();
}

async function readNestedTimelineDoc(params: {
  path: string;
  projectStore: ReturnType<typeof useProjectStore>;
  fallbackFormat?: TimelineFormatInput;
  cache?: Map<string, TimelineDocument>;
}): Promise<TimelineDocument | null> {
  const path = normalizeProjectPath(params.path);

  const file = await params.projectStore.getFileByPath(path);
  if (!file) return null;

  const mtime = file.lastModified;
  const cached = _nestedDocCache.get(path);
  if (cached && cached.mtime === mtime) {
    return cached.doc;
  }

  const text = await withFileIoSlot(() => file.text());
  const doc = parseTimelineFromOtio(text, {
    id: 'nested',
    name: path.split('/').pop() ?? 'nested',
    format: params.fallbackFormat ?? params.projectStore.projectSettings.project,
  });

  _nestedDocCache.set(path, { doc, mtime });
  params.cache?.set(path, doc);
  return doc;
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

  for (let index = 0; index < visibleTracks.length; index++) {
    const track = visibleTracks[index];
    if (!track) continue;

    const layer = baseLayerOffset + (visibleTracks.length - 1 - index);
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
        parentOpacity: trackOpacity,
        parentBlendMode: trackBlendMode,
        parentEffects: trackEffects,
        fallbackFormat: params.fallbackFormat,
        onWarning: params.onWarning,
        nestedTimelinePath: params.nestedTimelinePath,
        nestedDocCache,
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
  projectStore: ReturnType<typeof useProjectStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
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

function getTimelinePlaybackSpeed(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value === 0) return 1;
  return value;
}

interface NestedClipWindow {
  overlapStartUs: number;
  overlapEndUs: number;
  parentStartUs: number;
  parentDurationUs: number;
  parentLocalStartUs: number;
  parentLocalEndUs: number;
}

function getNestedClipWindow(params: {
  nestedClip: WorkerTimelineClip;
  parentItem: TimelineTrackItem;
}): NestedClipWindow | null {
  const { nestedClip, parentItem } = params;
  const parentSpeedRaw = getTimelinePlaybackSpeed(
    (parentItem as import('~/timeline/types').TimelineClipItem).speed,
  );
  const parentSpeed = Math.abs(parentSpeedRaw);
  const isReversed = parentSpeedRaw < 0;
  const nestedStartUs = nestedClip.timelineRange.startUs;
  const nestedEndUs = nestedStartUs + nestedClip.timelineRange.durationUs;
  const parentSourceRange = (parentItem as import('~/timeline/types').TimelineClipItem).sourceRange;
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

function mergeNestedClipSpeed(params: {
  parentItem: TimelineTrackItem;
  nestedClip: WorkerTimelineClip;
}): number | undefined {
  const parentSpeedRaw = getTimelinePlaybackSpeed(
    (params.parentItem as import('~/timeline/types').TimelineClipItem).speed,
  );
  const nestedSpeedRaw = getTimelinePlaybackSpeed(params.nestedClip.speed);
  const combined = parentSpeedRaw * nestedSpeedRaw;
  return combined === 1 && params.nestedClip.speed === undefined ? undefined : combined;
}

function trimNestedClipToParentWindow(params: {
  nestedClip: WorkerTimelineClip;
  parentItem: TimelineTrackItem;
}): WorkerTimelineClip | null {
  const window = getNestedClipWindow(params);
  if (!window) return null;

  const trimmed = trimWorkerClipToRange(params.nestedClip, {
    startUs: window.overlapStartUs,
    endUs: window.overlapEndUs,
  });
  if (!trimmed) return null;

  return {
    ...trimmed,
    speed: mergeNestedClipSpeed(params),
    timelineRange: {
      startUs: window.parentStartUs,
      durationUs: window.parentDurationUs,
    },
  };
}

export async function toWorkerTimelineClips(
  items: TimelineTrackItem[],
  projectStore: ReturnType<typeof useProjectStore>,
  workspaceStore: ReturnType<typeof useWorkspaceStore>,
  options?: {
    layer?: number;
    trackKind?: 'video' | 'audio';
    visitedPaths?: Set<string>;
    nestedPathStack?: string[];
    parentOpacity?: number;
    parentBlendMode?: TimelineBlendMode;
    parentEffects?: ClipEffect[];
    parentAudioGain?: number;
    parentAudioBalance?: number;
    fallbackFormat?: TimelineFormatInput;
    onWarning?: (message: string) => void;
    nestedTimelinePath?: string;
    nestedDocCache?: Map<string, TimelineDocument>;
    trackIdPrefix?: string;
    onTrackBuilt?: (track: WorkerTrackPayloadSource) => void;
  },
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

    const itemEffects = Array.isArray(item.effects) ? cloneEffects(item.effects) : [];
    // Track-level effects are applied to the track container by the compositor;
    // merging them into every clip would cause double-application.
    const combinedEffects = itemEffects;

    const parentAudioBalance = options?.parentAudioBalance ?? 0;
    const parentAudioGain = options?.parentAudioGain ?? 1;

    const base: WorkerTimelineClip = {
      kind: 'clip',
      clipType: clipType === 'timeline' ? 'media' : clipType,
      id: item.id,
      trackId: item.trackId,
      layer:
        options?.layer ??
        (typeof item.layer === 'number' && Number.isFinite(item.layer)
          ? Math.round(item.layer)
          : 0),
      speed: item.speedActive !== false ? item.speed : undefined,
      audioGain: mergeGain(parentAudioGain, item.audioGain),
      audioBalance: mergeBalance(parentAudioBalance, item.audioBalance),
      // Clip-only gain/balance (track bus excluded). The native mixer applies the
      // owning track's gain/balance separately on its bus, so the layer must not
      // also carry it — otherwise track gain/balance is applied twice. `item.audioGain`
      // above is the merged track×clip value the web mixer needs; the originals are
      // the clip's own value, set by buildEffectiveAudioClipItems.
      originalAudioGain: mergeGain(parentAudioGain, item.originalAudioGain),
      originalAudioBalance: mergeBalance(parentAudioBalance, item.originalAudioBalance),
      audioFadeInUs: item.audioFadesActive !== false ? item.audioFadeInUs : undefined,
      audioFadeOutUs: item.audioFadesActive !== false ? item.audioFadeOutUs : undefined,
      audioFadeInCurve: item.audioFadesActive !== false ? item.audioFadeInCurve : undefined,
      audioFadeOutCurve: item.audioFadesActive !== false ? item.audioFadeOutCurve : undefined,
      audioDeclickDurationUs: projectStore.projectSettings.project.audioDeclickDurationUs,
      defaultAudioFadeCurve: workspaceStore.userSettings.projectDefaults.defaultAudioFadeCurve,
      opacity: item.opacityActive !== false ? combinedOpacity : undefined,
      blendMode: item.blendModeActive !== false ? combinedBlendMode : undefined,
      effects: combinedEffects.length > 0 ? combinedEffects : undefined,
      mask: item.maskActive !== false ? clonePlain(item.mask) : undefined,
      transform: item.transformActive !== false ? clonePlain(item.transform) : undefined,
      sourceOrientation: item.sourceOrientation,
      transitionIn: clonePlain(item.transitionIn),
      transitionOut: clonePlain(item.transitionOut),
      sourceDurationUs:
        typeof item.sourceDurationUs === 'number' ? item.sourceDurationUs : undefined,
      shapeType: item.shapeType,
      fillColor: item.fillColor,
      strokeColor: item.strokeColor,
      strokeWidth: item.strokeWidth,
      shapeConfig: clonePlain(item.shapeConfig),
      hudType: item.hudType,
      background: clonePlain(item.background),
      content: clonePlain(item.content),
      frame: clonePlain(item.frame),
      timelineRange: {
        startUs: item.timelineRange.startUs,
        durationUs: item.timelineRange.durationUs,
      },
      sourceRange: {
        startUs: item.sourceRange.startUs,
        durationUs: item.sourceRange.durationUs,
      },
    };

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
          const nestedDoc = await readNestedTimelineDoc({
            path,
            projectStore,
            fallbackFormat: options?.fallbackFormat,
            cache: nestedDocCache,
          });
          if (!nestedDoc) {
            log.warn(`Nested timeline file not found: ${path}`);
            continue;
          }

          const nextVisited = new Set(visitedPaths).add(path);
          const nextNestedPathStack = [...nestedPathStack, path];

          if (trackKind === 'video') {
            const nestedVideoTracks = nestedDoc.tracks.filter(
              (t) => t.kind === 'video' && !t.videoHidden,
            );
            for (let i = 0; i < nestedVideoTracks.length; i++) {
              const track = nestedVideoTracks[i];
              if (!track) continue;
              const nestedLayer = (options?.layer ?? 0) + (nestedVideoTracks.length - 1 - i);

              const trackEffects = Array.isArray(track.effects) ? cloneEffects(track.effects) : [];
              const combinedTrackEffects =
                combinedEffects.length > 0 ? [...trackEffects, ...combinedEffects] : trackEffects;

              const nextTrackIdPrefix = `${options?.trackIdPrefix ?? ''}${item.trackId}::${item.id}::`;
              const nestedTrackId = `${nextTrackIdPrefix}${track.id}`;

              if (options?.onTrackBuilt) {
                options.onTrackBuilt({
                  id: nestedTrackId,
                  layer: nestedLayer,
                  opacity: combinedOpacity * (track.opacity ?? 1),
                  blendMode: track.blendMode ?? combinedBlendMode,
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
                  parentOpacity: combinedOpacity,
                  parentBlendMode: combinedBlendMode,
                  parentEffects: combinedTrackEffects,
                  fallbackFormat: { fps: nestedDoc.timebase.fps },
                  onWarning: options?.onWarning,
                  nestedTimelinePath: path,
                  nestedDocCache,
                  trackIdPrefix: nextTrackIdPrefix,
                  onTrackBuilt: options?.onTrackBuilt,
                },
              );

              for (const nClip of nestedWorkerClips) {
                const resolvedNClip: WorkerTimelineClip =
                  nClip.clipType === 'media' && nClip.source?.path
                    ? {
                        ...nClip,
                        source: {
                          path: resolveNestedMediaPath({
                            nestedTimelinePath: path,
                            mediaPath: nClip.source.path,
                          }),
                        },
                      }
                    : nClip;

                const window = getNestedClipWindow({
                  nestedClip: resolvedNClip,
                  parentItem: item,
                });
                const trimmedNestedClip = trimNestedClipToParentWindow({
                  nestedClip: resolvedNClip,
                  parentItem: item,
                });

                if (window && trimmedNestedClip) {
                  clips.push({
                    ...trimmedNestedClip,
                    id: `${item.id}_nested_${resolvedNClip.id}`,
                    trackId: resolvedNClip.trackId
                      ? `${item.trackId}::${item.id}::${resolvedNClip.trackId}`
                      : undefined,
                    layer: nestedLayer,
                    audioGain: resolvedNClip.audioGain,
                    audioBalance: resolvedNClip.audioBalance,
                    audioFadeInUs: mergeFadeInUs({
                      childFadeInUs: resolvedNClip.audioFadeInUs,
                      parentFadeInUs: item.audioFadeInUs,
                      parentLocalStartUs: window.parentLocalStartUs,
                    }),
                    audioFadeOutUs: mergeFadeOutUs({
                      childFadeOutUs: resolvedNClip.audioFadeOutUs,
                      parentFadeOutUs: item.audioFadeOutUs,
                      parentLocalEndUs: window.parentLocalEndUs,
                      parentDurationUs: Math.max(0, Math.round(item.timelineRange.durationUs)),
                    }),
                    audioFadeInCurve: resolvedNClip.audioFadeInCurve ?? item.audioFadeInCurve,
                    audioFadeOutCurve: resolvedNClip.audioFadeOutCurve ?? item.audioFadeOutCurve,
                  });
                }
              }
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
              },
            );

            for (const nClip of nestedWorkerClips) {
              const resolvedNClip: WorkerTimelineClip =
                nClip.clipType === 'media' && nClip.source?.path
                  ? {
                      ...nClip,
                      source: {
                        path: resolveNestedMediaPath({
                          nestedTimelinePath: path,
                          mediaPath: nClip.source.path,
                        }),
                      },
                    }
                  : nClip;

              const window = getNestedClipWindow({
                nestedClip: resolvedNClip,
                parentItem: item,
              });
              const trimmedNestedClip = trimNestedClipToParentWindow({
                nestedClip: resolvedNClip,
                parentItem: item,
              });

              if (window && trimmedNestedClip) {
                const parentDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

                clips.push({
                  ...trimmedNestedClip,
                  id: `${item.id}_nested_${resolvedNClip.id}`,
                  trackId: resolvedNClip.trackId,
                  layer: 0,
                  audioGain: resolvedNClip.audioGain,
                  audioBalance: resolvedNClip.audioBalance,
                  // A nested clip's track_id is the *inner* doc's track, which has no
                  // matching native bus (the scene only exposes outer-doc tracks), so
                  // the layer is mixed straight into master as an orphan. It must
                  // therefore carry the full merged gain/balance — not the clip-only
                  // value — since no bus will re-apply the (already-merged) track stage.
                  originalAudioGain: resolvedNClip.audioGain,
                  originalAudioBalance: resolvedNClip.audioBalance,
                  audioFadeInUs: mergeFadeInUs({
                    childFadeInUs: resolvedNClip.audioFadeInUs,
                    parentFadeInUs: item.audioFadeInUs,
                    parentLocalStartUs: window.parentLocalStartUs,
                  }),
                  audioFadeOutUs: mergeFadeOutUs({
                    childFadeOutUs: resolvedNClip.audioFadeOutUs,
                    parentFadeOutUs: item.audioFadeOutUs,
                    parentLocalEndUs: window.parentLocalEndUs,
                    parentDurationUs,
                  }),
                  audioFadeInCurve: resolvedNClip.audioFadeInCurve ?? item.audioFadeInCurve,
                  audioFadeOutCurve: resolvedNClip.audioFadeOutCurve ?? item.audioFadeOutCurve,
                });
              }
            }
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
    } else if (clipType === 'background') {
      clips.push({
        ...base,
        backgroundColor: sanitizeTimelineColor(item.backgroundColor, '#000000'),
      });
    } else if (clipType === 'text') {
      clips.push({
        ...base,
        text: String(item.text ?? ''),
        style: clonePlain(item.style),
      });
    } else if (clipType === 'shape') {
      clips.push({
        ...base,
        shapeType: item.shapeType ?? 'square',
        fillColor: typeof item.fillColor === 'string' ? item.fillColor : undefined,
        strokeColor: typeof item.strokeColor === 'string' ? item.strokeColor : undefined,
        strokeWidth: typeof item.strokeWidth === 'number' ? item.strokeWidth : undefined,
        shapeConfig: clonePlain(item.shapeConfig),
      });
    } else if (clipType === 'hud') {
      clips.push({
        ...base,
        hudType: item.hudType ?? 'media_frame',
        background: clonePlain(item.background),
        content: clonePlain(item.content),
        frame: clonePlain(item.frame),
      });
    } else {
      clips.push(base);
    }
  }
  return clips;
}
