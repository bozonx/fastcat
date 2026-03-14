import type { useProjectStore } from '~/stores/project.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import { parseTimelineFromOtio } from '~/timeline/otioSerializer';
import type {
  TimelineTrack,
  TimelineTrackItem,
  TimelineSelectionRange,
  TimelineBlendMode,
  ClipEffect,
} from '~/timeline/types';
import { clampNumber, mergeBalance, mergeGain } from '~/utils/audio/envelope';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import {
  cloneEffects,
  clonePlain,
  mergeFadeInUs,
  mergeFadeOutUs,
  resolveNestedMediaPath,
} from '~/utils/video-editor/worker-clip-utils';
import { sanitizeTimelineColor } from '~/utils/video-editor/utils';
import type {
  WorkerTimelineClip,
  WorkerTrackPayloadSource,
  WorkerVideoPayloadItem,
  WorkerTimelineTrack,
  WorkerTimelineMeta,
} from './types';

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

    for (const item of track.items) {
      if (item.kind !== 'clip') continue;
      if ((item as any).disabled) continue;

      const clipType = (item as any).clipType ?? 'media';
      const itemEffects = Array.isArray(item.effects) ? cloneEffects(item.effects) : [];

      const baseClip: WorkerTimelineClip = {
        kind: 'clip',
        clipType: clipType === 'timeline' ? 'media' : clipType,
        id: item.id,
        trackId: runtimeTrackId,
        layer,
        speed: (item as any).speed,
        audioGain: (item as any).audioGain,
        audioBalance: (item as any).audioBalance,
        audioFadeInUs: (item as any).audioFadeInUs,
        audioFadeOutUs: (item as any).audioFadeOutUs,
        audioFadeInCurve: (item as any).audioFadeInCurve,
        audioFadeOutCurve: (item as any).audioFadeOutCurve,
        audioDeclickDurationUs:
          params.workspaceStore.userSettings.projectDefaults.audioDeclickDurationUs,
        opacity: item.opacity,
        blendMode: item.blendMode,
        effects: itemEffects.length > 0 ? itemEffects : undefined,
        transform: clonePlain((item as any).transform),
        transitionIn: clonePlain((item as any).transitionIn),
        transitionOut: clonePlain((item as any).transitionOut),
        freezeFrameSourceUs: item.freezeFrameSourceUs,
        sourceDurationUs:
          typeof (item as any).sourceDurationUs === 'number'
            ? (item as any).sourceDurationUs
            : undefined,
        timelineRange: {
          startUs: item.timelineRange.startUs,
          durationUs: item.timelineRange.durationUs,
        },
        sourceRange: {
          startUs: item.sourceRange.startUs,
          durationUs: item.sourceRange.durationUs,
        },
      };

      if (clipType === 'timeline') {
        const path = (item as any).source?.path;
        if (!path) continue;

        if (visitedPaths.has(path)) {
          console.warn(
            'Circular dependency detected in nested timeline:',
            [...nestedPathStack, path].join(' -> '),
          );
          continue;
        }

        try {
          const file = await params.projectStore.getFileByPath(path);
          if (!file) continue;
          const text = await file.text();
          const nestedDoc = parseTimelineFromOtio(text, {
            id: 'nested',
            name: 'nested',
            fps: 25,
          });

          const nestedResult = await buildVideoTrackTree({
            tracks: nestedDoc.tracks,
            projectStore: params.projectStore,
            workspaceStore: params.workspaceStore,
            layerOffset: layer,
            trackIdPrefix: `${runtimeTrackId}::${item.id}`,
            visitedPaths: new Set(visitedPaths).add(path),
            nestedPathStack: [...nestedPathStack, path],
            nestedTimelinePath: path,
            inheritedTrackOpacity: trackOpacity * (item.opacity ?? 1),
            inheritedTrackBlendMode: item.blendMode ?? trackBlendMode,
            inheritedTrackEffects:
              trackEffects.length > 0 ? [...itemEffects, ...trackEffects] : itemEffects,
          });

          result.tracks.push(...nestedResult.tracks);

          for (const nestedClip of nestedResult.clips) {
            const nestedStartUs = nestedClip.timelineRange.startUs;
            const nestedEndUs = nestedStartUs + nestedClip.timelineRange.durationUs;
            const windowStartUs = item.sourceRange.startUs;
            const windowEndUs = windowStartUs + item.sourceRange.durationUs;
            const overlapStartUs = Math.max(nestedStartUs, windowStartUs);
            const overlapEndUs = Math.min(nestedEndUs, windowEndUs);

            if (overlapStartUs >= overlapEndUs) continue;

            const visibleDurationUs = overlapEndUs - overlapStartUs;
            const parentStartUs = item.timelineRange.startUs + (overlapStartUs - windowStartUs);
            const sourceShiftUs = overlapStartUs - nestedStartUs;

            result.clips.push({
              ...nestedClip,
              id: `${item.id}_nested_${nestedClip.id}`,
              timelineRange: {
                startUs: parentStartUs,
                durationUs: visibleDurationUs,
              },
              sourceRange: {
                startUs: nestedClip.sourceRange.startUs + sourceShiftUs,
                durationUs: visibleDurationUs,
              },
              audioGain: mergeGain((item as any).audioGain, nestedClip.audioGain),
              audioBalance: mergeBalance((item as any).audioBalance, nestedClip.audioBalance),
              audioFadeInUs: mergeFadeInUs({
                childFadeInUs: nestedClip.audioFadeInUs,
                parentFadeInUs: (item as any).audioFadeInUs,
                parentLocalStartUs: overlapStartUs - windowStartUs,
              }),
              audioFadeOutUs: mergeFadeOutUs({
                childFadeOutUs: nestedClip.audioFadeOutUs,
                parentFadeOutUs: (item as any).audioFadeOutUs,
                parentLocalEndUs: overlapEndUs - windowStartUs,
                parentDurationUs: Math.max(0, Math.round(item.timelineRange.durationUs)),
              }),
              audioFadeInCurve: nestedClip.audioFadeInCurve ?? (item as any).audioFadeInCurve,
              audioFadeOutCurve: nestedClip.audioFadeOutCurve ?? (item as any).audioFadeOutCurve,
            });
          }
        } catch (error) {
          console.error('Failed to expand nested timeline', error);
        }

        continue;
      }

      if (clipType === 'media') {
        const rawPath = (item as any).source?.path;
        if (!rawPath) continue;

        result.clips.push({
          ...baseClip,
          source: {
            path: params.nestedTimelinePath
              ? resolveNestedMediaPath({
                  nestedTimelinePath: params.nestedTimelinePath,
                  mediaPath: rawPath,
                })
              : rawPath,
          },
        });
        continue;
      }

      if (clipType === 'background') {
        result.clips.push({
          ...baseClip,
          backgroundColor: sanitizeTimelineColor((item as any).backgroundColor, '#000000'),
        });
        continue;
      }

      if (clipType === 'text') {
        result.clips.push({
          ...baseClip,
          text: String((item as any).text ?? ''),
          style: clonePlain((item as any).style),
        });
        continue;
      }

      if (clipType === 'shape') {
        result.clips.push({
          ...baseClip,
          shapeType: (item as any).shapeType ?? 'square',
          fillColor:
            typeof (item as any).fillColor === 'string' ? (item as any).fillColor : undefined,
          strokeColor:
            typeof (item as any).strokeColor === 'string' ? (item as any).strokeColor : undefined,
          strokeWidth:
            typeof (item as any).strokeWidth === 'number' ? (item as any).strokeWidth : undefined,
        });
        continue;
      }

      if (clipType === 'hud') {
        result.clips.push({
          ...baseClip,
          hudType: (item as any).hudType ?? 'media_frame',
          background: clonePlain((item as any).background),
          content: clonePlain((item as any).content),
        });
        continue;
      }

      result.clips.push(baseClip);
    }
  }

  return result;
}

export async function buildVideoWorkerPayloadFromTracks(input: {
  tracks: TimelineTrack[];
  projectStore: ReturnType<typeof useProjectStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  masterEffects?: ClipEffect[];
}): Promise<BuildVideoPayloadFromTracksResult> {
  const result = await buildVideoTrackTree({
    tracks: input.tracks,
    projectStore: input.projectStore,
    workspaceStore: input.workspaceStore,
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
  const trimmedDurationUs = overlapEndUs - overlapStartUs;

  return {
    ...clip,
    timelineRange: {
      startUs: overlapStartUs - range.startUs,
      durationUs: trimmedDurationUs,
    },
    sourceRange: {
      startUs: clip.sourceRange.startUs + trimStartUs,
      durationUs: trimmedDurationUs,
    },
  };
}

export async function toWorkerTimelineClips(
  items: TimelineTrackItem[],
  projectStore: ReturnType<typeof useProjectStore>,
  options?: {
    layer?: number;
    trackKind?: 'video' | 'audio';
    visitedPaths?: Set<string>;
    nestedPathStack?: string[];
    parentOpacity?: number;
    parentBlendMode?: TimelineBlendMode;
    parentEffects?: ClipEffect[];
  },
): Promise<WorkerTimelineClip[]> {
  const clips: WorkerTimelineClip[] = [];
  const trackKind = options?.trackKind ?? 'video';
  const visitedPaths = options?.visitedPaths ?? new Set<string>();
  const nestedPathStack = options?.nestedPathStack ?? [];

  for (const item of items) {
    if (item.kind !== 'clip') continue;
    if ((item as any).disabled) continue;

    const clipType = (item as any).clipType ?? 'media';
    const parentOpacity = options?.parentOpacity ?? 1;
    const itemOpacity = item.opacity ?? 1;
    const combinedOpacity = parentOpacity * itemOpacity;
    const combinedBlendMode = item.blendMode ?? options?.parentBlendMode;

    const parentEffects = options?.parentEffects ?? [];
    const itemEffects = Array.isArray(item.effects) ? cloneEffects(item.effects) : [];
    const combinedEffects =
      parentEffects.length > 0 ? [...itemEffects, ...parentEffects] : itemEffects;

    const parentAudioBalance = (options as any)?.parentAudioBalance ?? 0;
    const parentAudioGain = (options as any)?.parentAudioGain ?? 1;

    const base: WorkerTimelineClip = {
      kind: 'clip',
      clipType: clipType === 'timeline' ? 'media' : (clipType as any),
      id: item.id,
      trackId: item.trackId,
      layer:
        options?.layer ??
        (typeof (item as any).layer === 'number' && Number.isFinite((item as any).layer)
          ? Math.round((item as any).layer)
          : 0),
      speed: (item as any).speed,
      audioGain: mergeGain(parentAudioGain, (item as any).audioGain),
      audioBalance: mergeBalance(parentAudioBalance, (item as any).audioBalance),
      audioFadeInUs: (item as any).audioFadeInUs,
      audioFadeOutUs: (item as any).audioFadeOutUs,
      audioFadeInCurve: (item as any).audioFadeInCurve,
      audioFadeOutCurve: (item as any).audioFadeOutCurve,
      audioDeclickDurationUs: projectStore.projectSettings.project.audioDeclickDurationUs,
      opacity: combinedOpacity,
      blendMode: combinedBlendMode,
      effects: combinedEffects.length > 0 ? combinedEffects : undefined,
      transform: clonePlain((item as any).transform),
      transitionIn: clonePlain((item as any).transitionIn),
      transitionOut: clonePlain((item as any).transitionOut),
      sourceDurationUs:
        typeof (item as any).sourceDurationUs === 'number'
          ? (item as any).sourceDurationUs
          : undefined,
      shapeType: (item as any).shapeType,
      fillColor: (item as any).fillColor,
      strokeColor: (item as any).strokeColor,
      strokeWidth: (item as any).strokeWidth,
      hudType: (item as any).hudType,
      background: clonePlain((item as any).background),
      content: clonePlain((item as any).content),
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
      const path = (item as any).source?.path;
      if (!path) continue;

      if (clipType === 'timeline') {
        if (visitedPaths.has(path)) {
          console.warn(
            'Circular dependency detected in nested timeline:',
            [...nestedPathStack, path].join(' -> '),
          );
          continue;
        }

        try {
          const file = await projectStore.getFileByPath(path);
          if (file) {
            const text = await file.text();
            const nestedDoc = parseTimelineFromOtio(text, {
              id: 'nested',
              name: 'nested',
              fps: 25,
            });

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

                const trackEffects = Array.isArray(track.effects)
                  ? cloneEffects(track.effects)
                  : [];
                const combinedTrackEffects =
                  combinedEffects.length > 0 ? [...trackEffects, ...combinedEffects] : trackEffects;

                const nestedWorkerClips = await toWorkerTimelineClips(track.items, projectStore, {
                  layer: nestedLayer,
                  trackKind: 'video',
                  visitedPaths: nextVisited,
                  nestedPathStack: nextNestedPathStack,
                  parentOpacity: combinedOpacity,
                  parentBlendMode: combinedBlendMode,
                  parentEffects: combinedTrackEffects,
                });

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

                  const nStartUs = resolvedNClip.timelineRange.startUs;
                  const nEndUs = nStartUs + resolvedNClip.timelineRange.durationUs;

                  const windowStartUs = item.sourceRange.startUs;
                  const windowEndUs = windowStartUs + item.sourceRange.durationUs;

                  const overlapStartUs = Math.max(nStartUs, windowStartUs);
                  const overlapEndUs = Math.min(nEndUs, windowEndUs);

                  if (overlapStartUs < overlapEndUs) {
                    const visibleDurationUs = overlapEndUs - overlapStartUs;
                    const parentStartUs =
                      item.timelineRange.startUs + (overlapStartUs - windowStartUs);
                    const sourceShiftUs = overlapStartUs - nStartUs;

                    clips.push({
                      ...resolvedNClip,
                      id: `${item.id}_nested_${resolvedNClip.id}`,
                      trackId: resolvedNClip.trackId
                        ? `${item.trackId}::${item.id}::${resolvedNClip.trackId}`
                        : undefined,
                      layer: nestedLayer,
                      audioGain: resolvedNClip.audioGain,
                      audioBalance: resolvedNClip.audioBalance,
                      audioFadeInUs: mergeFadeInUs({
                        childFadeInUs: resolvedNClip.audioFadeInUs,
                        parentFadeInUs: (item as any).audioFadeInUs,
                        parentLocalStartUs: overlapStartUs - windowStartUs,
                      }),
                      audioFadeOutUs: mergeFadeOutUs({
                        childFadeOutUs: resolvedNClip.audioFadeOutUs,
                        parentFadeOutUs: (item as any).audioFadeOutUs,
                        parentLocalEndUs: overlapEndUs - windowStartUs,
                        parentDurationUs: Math.max(0, Math.round(item.timelineRange.durationUs)),
                      }),
                      audioFadeInCurve:
                        resolvedNClip.audioFadeInCurve ?? (item as any).audioFadeInCurve,
                      audioFadeOutCurve:
                        resolvedNClip.audioFadeOutCurve ?? (item as any).audioFadeOutCurve,
                      timelineRange: {
                        startUs: parentStartUs,
                        durationUs: visibleDurationUs,
                      },
                      sourceRange: {
                        startUs: resolvedNClip.sourceRange.startUs + sourceShiftUs,
                        durationUs: visibleDurationUs,
                      },
                    });
                  }
                }
              }
            } else if (trackKind === 'audio') {
              const nestedAudioItems = buildEffectiveAudioClipItems({
                audioTracks: nestedDoc.tracks.filter((t) => t.kind === 'audio'),
                videoTracks: nestedDoc.tracks.filter((t) => t.kind === 'video'),
              });

              const nestedWorkerClips = await toWorkerTimelineClips(
                nestedAudioItems,
                projectStore,
                {
                  layer: 0,
                  trackKind: 'audio',
                  visitedPaths: nextVisited,
                  nestedPathStack: nextNestedPathStack,
                  parentOpacity: combinedOpacity,
                  parentBlendMode: combinedBlendMode,
                  parentEffects: combinedEffects,
                  parentAudioGain: mergeGain(parentAudioGain, (item as any).audioGain),
                  parentAudioBalance: mergeBalance(parentAudioBalance, (item as any).audioBalance),
                } as any,
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

                const nStartUs = resolvedNClip.timelineRange.startUs;
                const nEndUs = nStartUs + resolvedNClip.timelineRange.durationUs;

                const windowStartUs = item.sourceRange.startUs;
                const windowEndUs = windowStartUs + item.sourceRange.durationUs;

                const overlapStartUs = Math.max(nStartUs, windowStartUs);
                const overlapEndUs = Math.min(nEndUs, windowEndUs);

                if (overlapStartUs < overlapEndUs) {
                  const visibleDurationUs = overlapEndUs - overlapStartUs;
                  const parentStartUs =
                    item.timelineRange.startUs + (overlapStartUs - windowStartUs);
                  const sourceShiftUs = overlapStartUs - nStartUs;

                  const parentLocalStartUs = overlapStartUs - windowStartUs;
                  const parentLocalEndUs = overlapEndUs - windowStartUs;
                  const parentDurationUs = Math.max(0, Math.round(item.timelineRange.durationUs));

                  clips.push({
                    ...resolvedNClip,
                    id: `${item.id}_nested_${resolvedNClip.id}`,
                    trackId: resolvedNClip.trackId,
                    layer: 0,
                    audioGain: resolvedNClip.audioGain,
                    audioBalance: resolvedNClip.audioBalance,
                    audioFadeInUs: mergeFadeInUs({
                      childFadeInUs: resolvedNClip.audioFadeInUs,
                      parentFadeInUs: (item as any).audioFadeInUs,
                      parentLocalStartUs,
                    }),
                    audioFadeOutUs: mergeFadeOutUs({
                      childFadeOutUs: resolvedNClip.audioFadeOutUs,
                      parentFadeOutUs: (item as any).audioFadeOutUs,
                      parentLocalEndUs,
                      parentDurationUs,
                    }),
                    audioFadeInCurve:
                      resolvedNClip.audioFadeInCurve ?? (item as any).audioFadeInCurve,
                    audioFadeOutCurve:
                      resolvedNClip.audioFadeOutCurve ?? (item as any).audioFadeOutCurve,
                    timelineRange: {
                      startUs: parentStartUs,
                      durationUs: visibleDurationUs,
                    },
                    sourceRange: {
                      startUs: resolvedNClip.sourceRange.startUs + sourceShiftUs,
                      durationUs: visibleDurationUs,
                    },
                  });
                }
              }
            }
            continue;
          }
        } catch (e) {
          console.error('Failed to expand nested timeline', e);
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
        backgroundColor: sanitizeTimelineColor((item as any).backgroundColor, '#000000'),
      });
    } else if (clipType === 'text') {
      clips.push({
        ...base,
        text: String((item as any).text ?? ''),
        style: clonePlain((item as any).style),
      });
    } else if (clipType === 'shape') {
      clips.push({
        ...base,
        shapeType: (item as any).shapeType ?? 'square',
        fillColor:
          typeof (item as any).fillColor === 'string' ? (item as any).fillColor : undefined,
        strokeColor:
          typeof (item as any).strokeColor === 'string' ? (item as any).strokeColor : undefined,
        strokeWidth:
          typeof (item as any).strokeWidth === 'number' ? (item as any).strokeWidth : undefined,
      });
    } else if (clipType === 'hud') {
      clips.push({
        ...base,
        hudType: (item as any).hudType ?? 'media_frame',
        background: clonePlain((item as any).background),
        content: clonePlain((item as any).content),
      });
    } else {
      clips.push(base);
    }
  }
  return clips;
}
