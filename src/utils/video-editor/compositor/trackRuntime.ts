import type { TimelineBlendMode, VideoClipEffect } from '~/timeline/types';
import type { CompositorClip } from './types';
import { resolveBlendMode } from './types';

export interface TrackRuntimeDefinition {
  id: string;
  layer: number;
  opacity?: number;
  blendMode?: TimelineBlendMode;
  effects?: VideoClipEffect[];
}

export function normalizeTrackOpacity(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1, value));
}

export function buildTrackRuntimeList(
  timelineItems: unknown[],
  toVideoEffects: (value: unknown) => VideoClipEffect[] | undefined,
): TrackRuntimeDefinition[] {
  const explicitTracks = timelineItems
    .filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).kind === 'track')
    .map((track) => {
      const t = track as Record<string, unknown>;
      return {
        id:
          typeof t.id === 'string' && t.id.length > 0
            ? t.id
            : `track_${String(t.layer ?? 0)}`,
        layer: Math.round(Number(t.layer ?? 0)),
        opacity: normalizeTrackOpacity(t.opacity),
        blendMode: resolveBlendMode(t.blendMode),
        effects: toVideoEffects(t.effects),
      };
    });

  const inferredLayers = new Set<number>();
  for (const item of timelineItems) {
    if (!item || typeof item !== 'object' || (item as Record<string, unknown>).kind !== 'clip') continue;
    inferredLayers.add(Math.round(Number((item as Record<string, unknown>).layer ?? 0)));
  }

  const explicitLayers = new Set(explicitTracks.map((track) => track.layer));
  const inferredTracks = [...inferredLayers]
    .filter((layer) => !explicitLayers.has(layer))
    .sort((a, b) => a - b)
    .map((layer) => ({
      id: `track_${layer}`,
      layer,
      opacity: 1,
      blendMode: 'normal' as const,
    }));

  return [...explicitTracks, ...inferredTracks].sort((a, b) => a.layer - b.layer);
}

export function buildPrevClipByIdIndex(
  clips: CompositorClip[],
): Map<string, CompositorClip | null> {
  const prevClipById = new Map<string, CompositorClip | null>();
  const byLayer = new Map<number, CompositorClip[]>();

  for (const clip of clips) {
    const layerClips = byLayer.get(clip.layer);
    if (layerClips) {
      layerClips.push(clip);
    } else {
      byLayer.set(clip.layer, [clip]);
    }
  }

  for (const layerClips of byLayer.values()) {
    const sorted = [...layerClips].sort(
      (a, b) => a.startUs - b.startUs || a.endUs - b.endUs || a.itemId.localeCompare(b.itemId),
    );

    for (let index = 0; index < sorted.length; index += 1) {
      const clip = sorted[index];
      if (!clip) continue;
      const prev = index > 0 ? (sorted[index - 1] ?? null) : null;
      prevClipById.set(clip.itemId, prev);
    }
  }

  return prevClipById;
}

export function buildNextClipByIdIndex(
  clips: CompositorClip[],
): Map<string, CompositorClip | null> {
  const nextClipById = new Map<string, CompositorClip | null>();
  const byLayer = new Map<number, CompositorClip[]>();

  for (const clip of clips) {
    const layerClips = byLayer.get(clip.layer);
    if (layerClips) {
      layerClips.push(clip);
    } else {
      byLayer.set(clip.layer, [clip]);
    }
  }

  for (const layerClips of byLayer.values()) {
    const sorted = [...layerClips].sort(
      (a, b) => a.startUs - b.startUs || a.endUs - b.endUs || a.itemId.localeCompare(b.itemId),
    );

    for (let index = 0; index < sorted.length; index += 1) {
      const clip = sorted[index];
      if (!clip) continue;
      const next = index < sorted.length - 1 ? (sorted[index + 1] ?? null) : null;
      nextClipById.set(clip.itemId, next);
    }
  }

  return nextClipById;
}
