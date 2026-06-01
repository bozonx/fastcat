import {
  buildVideoWorkerPayloadFromTracks,
  toWorkerTimelineClips,
} from '~/composables/timeline/export';
import type { WorkerTimelineClip } from '~/composables/timeline/export/types';
import type { useProjectStore } from '~/stores/project.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import type {
  ClipTransform,
  ShapeConfig,
  TimelineDocument,
  TimelineShapeClipItem,
  TimelineTextClipItem,
} from '~/timeline/types';
import type { TimelineFormatInput } from '~/timeline/format';
import { getTimelineFormat } from '~/timeline/format';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import { resolveNormalizedAnchor, TRANSFORM_DESIGN_BASE } from '~/utils/video-editor/clip-layout';
import type { TauriDirectoryHandle } from '~/stores/workspace/provider/tauri-handle';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);
const SVG_EXT = new Set(['svg']);

export interface NativeSceneLayer {
  id: string;
  kind: 'video' | 'image' | 'svg' | 'text' | 'shape' | 'background';
  path?: string;
  timeline_start_sec: number;
  timeline_end_sec: number;
  source_start_sec: number;
  source_range_duration_sec: number;
  speed: number;
  freeze_frame_source_sec?: number;
  source_orientation?: string;
  z: number;
  opacity: number;
  blend_mode?: string;
  background_color?: string;
  text?: string;
  style?: TimelineTextClipItem['style'];
  shape_type?: TimelineShapeClipItem['shapeType'];
  fill_color?: string;
  stroke_color?: string;
  stroke_width?: number;
  shape_config?: ShapeConfig;
  transform?: {
    x: number;
    y: number;
    scale_x: number;
    scale_y: number;
    rotation_deg: number;
    anchor_x: number;
    anchor_y: number;
  };
  transition_in?: {
    type: string;
    duration_sec: number;
    curve?: string;
  };
  transition_out?: {
    type: string;
    duration_sec: number;
    curve?: string;
  };
}

export interface NativeSceneAudioLayer {
  id: string;
  track_id?: string;
  path: string;
  timeline_start_sec: number;
  timeline_end_sec: number;
  source_start_sec: number;
  speed: number;
  audio_gain: number;
  audio_balance: number;
  audio_fade_in_sec: number;
  audio_fade_out_sec: number;
  audio_fade_in_curve: 'linear' | 'logarithmic';
  audio_fade_out_curve: 'linear' | 'logarithmic';
}

export interface NativeAudioTrack {
  id: string;
  audio_gain: number;
  audio_balance: number;
  audio_muted: boolean;
  audio_solo: boolean;
}

export interface NativeMonitorScene {
  layers: NativeSceneLayer[];
  audio_layers?: NativeSceneAudioLayer[];
  audio_tracks?: NativeAudioTrack[];
  audio_master_gain: number;
  audio_master_muted: boolean;
  width: number;
  height: number;
  preview_scale?: number;
  preview_fps?: number;
}

export interface BuildNativeMonitorSceneParams {
  timelineDoc: TimelineDocument;
  projectStore: ReturnType<typeof useProjectStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  masterGain?: number;
  masterMuted?: boolean;
  previewScale?: number;
  fallbackFormat?: TimelineFormatInput;
  includeAudio?: boolean;
  onWarning?: (message: string) => void;
}

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i + 1).toLowerCase() : '';
}

function isImageLayer(clip: WorkerTimelineClip): boolean {
  return IMAGE_EXT.has(extOf(clip.source?.path ?? ''));
}

function isSvgLayer(clip: WorkerTimelineClip): boolean {
  return SVG_EXT.has(extOf(clip.source?.path ?? ''));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeVideoSpeed(value: unknown): number {
  const speed = finite(value, 1);
  if (speed === 0) return 1;
  return Math.max(-10, Math.min(10, speed));
}

function sanitizeAudioSpeed(value: unknown): number {
  return Math.max(0.01, Math.min(100, Math.abs(finite(value, 1) || 1)));
}

function buildNativeTransform(
  transform: ClipTransform | undefined,
  sceneWidth: number,
  sceneHeight: number,
) {
  if (!transform) return undefined;
  const anchor = resolveNormalizedAnchor(transform.anchor);
  return {
    x:
      sceneWidth / 2 +
      finite(transform.position?.x, 0) * (sceneWidth / TRANSFORM_DESIGN_BASE.width),
    y:
      sceneHeight / 2 +
      finite(transform.position?.y, 0) * (sceneHeight / TRANSFORM_DESIGN_BASE.height),
    scale_x: finite(transform.scale?.x, 1),
    scale_y: finite(transform.scale?.y, 1),
    rotation_deg: finite(transform.rotationDeg, 0),
    anchor_x: anchor.x,
    anchor_y: anchor.y,
  };
}

async function resolveProjectAbsolutePath(
  projectRelativePath: string,
  projectStore: ReturnType<typeof useProjectStore>,
): Promise<string> {
  try {
    const handle = await projectStore.getProjectDirHandle();
    const projectPath = (handle as unknown as TauriDirectoryHandle | null)?.path;
    if (!projectPath) return projectRelativePath;
    const { join } = await import('@tauri-apps/api/path');
    return await join(projectPath, projectRelativePath);
  } catch {
    return projectRelativePath;
  }
}

function buildBaseLayer(params: {
  clip: WorkerTimelineClip;
  sceneWidth: number;
  sceneHeight: number;
  z: number;
}): Omit<NativeSceneLayer, 'kind' | 'path'> {
  const { clip, sceneWidth, sceneHeight, z } = params;
  const startUs = clip.timelineRange.startUs;
  const durationUs = clip.timelineRange.durationUs;
  const sourceStartUs = clip.sourceRange.startUs;
  const sourceDurationUs = clip.sourceRange.durationUs;

  return {
    id: clip.id,
    timeline_start_sec: startUs / 1_000_000,
    timeline_end_sec: (startUs + durationUs) / 1_000_000,
    source_start_sec: sourceStartUs / 1_000_000,
    source_range_duration_sec: Math.max(0, sourceDurationUs) / 1_000_000,
    speed: sanitizeVideoSpeed(clip.speed),
    freeze_frame_source_sec:
      typeof clip.freezeFrameSourceUs === 'number'
        ? Math.max(0, clip.freezeFrameSourceUs) / 1_000_000
        : undefined,
    source_orientation: String(clip.sourceOrientation ?? 'auto'),
    z,
    opacity: Math.max(0, Math.min(1, finite(clip.opacity, 1))),
    blend_mode: clip.blendMode ?? 'normal',
    transform: buildNativeTransform(clip.transform, sceneWidth, sceneHeight),
    transition_in:
      clip.transitionIn && clip.transitionIn.durationUs > 0
        ? {
            type: clip.transitionIn.type,
            duration_sec: clip.transitionIn.durationUs / 1_000_000,
            curve: clip.transitionIn.curve,
          }
        : undefined,
    transition_out:
      clip.transitionOut && clip.transitionOut.durationUs > 0
        ? {
            type: clip.transitionOut.type,
            duration_sec: clip.transitionOut.durationUs / 1_000_000,
            curve: clip.transitionOut.curve,
          }
        : undefined,
  };
}

async function buildAudioLayers(params: {
  timelineDoc: TimelineDocument;
  projectStore: ReturnType<typeof useProjectStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  fallbackFormat: TimelineFormatInput;
  onWarning?: (message: string) => void;
}): Promise<NativeSceneAudioLayer[]> {
  const audioTracks = params.timelineDoc.tracks.filter((track) => track.kind === 'audio');
  const videoTracks = params.timelineDoc.tracks.filter((track) => track.kind === 'video');
  const effectiveAudioItems = buildEffectiveAudioClipItems({
    audioTracks,
    videoTracks,
    masterEffects: params.timelineDoc.metadata?.fastcat?.masterEffects,
  });
  const clips = await toWorkerTimelineClips(
    effectiveAudioItems,
    params.projectStore,
    params.workspaceStore,
    {
      trackKind: 'audio',
      fallbackFormat: params.fallbackFormat,
      onWarning: params.onWarning,
    },
  );

  const layers: NativeSceneAudioLayer[] = [];
  for (const clip of clips) {
    if (clip.clipType !== 'media') continue;
    const path = clip.source?.path;
    if (!path) continue;
    const startUs = clip.timelineRange.startUs;
    const durationUs = clip.timelineRange.durationUs;
    if (durationUs <= 0) continue;

    layers.push({
      id: clip.id,
      track_id: clip.trackId,
      path: await resolveProjectAbsolutePath(path, params.projectStore),
      timeline_start_sec: startUs / 1_000_000,
      timeline_end_sec: (startUs + durationUs) / 1_000_000,
      source_start_sec: clip.sourceRange.startUs / 1_000_000,
      speed: sanitizeAudioSpeed(clip.speed),
      audio_gain: Math.max(0, finite((clip as any).originalAudioGain ?? clip.audioGain, 1)),
      audio_balance: Math.max(
        -1,
        Math.min(1, finite((clip as any).originalAudioBalance ?? clip.audioBalance, 0)),
      ),
      audio_fade_in_sec: Math.max(0, finite(clip.audioFadeInUs, 0) / 1_000_000),
      audio_fade_out_sec: Math.max(0, finite(clip.audioFadeOutUs, 0) / 1_000_000),
      audio_fade_in_curve: clip.audioFadeInCurve ?? 'linear',
      audio_fade_out_curve: clip.audioFadeOutCurve ?? 'linear',
    });
  }
  return layers;
}

export async function buildNativeMonitorScene(
  params: BuildNativeMonitorSceneParams,
): Promise<NativeMonitorScene> {
  const format = getTimelineFormat(params.timelineDoc);
  const fallbackFormat = params.fallbackFormat ?? format;
  const sceneWidth = format.width;
  const sceneHeight = format.height;
  const nestedDocCache = new Map<string, TimelineDocument>();
  const builtVideo = await buildVideoWorkerPayloadFromTracks({
    tracks: params.timelineDoc.tracks,
    projectStore: params.projectStore,
    workspaceStore: params.workspaceStore,
    masterEffects: params.timelineDoc.metadata?.fastcat?.masterEffects,
    fallbackFormat,
    onWarning: params.onWarning,
    nestedDocCache,
  });

  const layers: NativeSceneLayer[] = [];
  for (const [index, clip] of builtVideo.clips.entries()) {
    if (clip.clipType === 'hud' || clip.clipType === 'adjustment') continue;
    const z = clip.layer * 1000 + index;
    const base = buildBaseLayer({ clip, sceneWidth, sceneHeight, z });

    if (clip.clipType === 'media') {
      const path = clip.source?.path;
      if (!path) continue;
      layers.push({
        ...base,
        kind: isSvgLayer(clip) ? 'svg' : isImageLayer(clip) ? 'image' : 'video',
        path: await resolveProjectAbsolutePath(path, params.projectStore),
      });
      continue;
    }

    if (clip.clipType === 'background') {
      layers.push({
        ...base,
        kind: 'background',
        background_color: clip.backgroundColor ?? '#000000',
      });
      continue;
    }

    if (clip.clipType === 'text') {
      layers.push({
        ...base,
        kind: 'text',
        text: clip.text ?? '',
        style: clip.style,
      });
      continue;
    }

    if (clip.clipType === 'shape') {
      layers.push({
        ...base,
        kind: 'shape',
        shape_type: clip.shapeType ?? 'square',
        fill_color: clip.fillColor ?? '#ffffff',
        stroke_color: clip.strokeColor ?? '#000000',
        stroke_width: clip.strokeWidth ?? 0,
        shape_config: clip.shapeConfig,
      });
    }
  }

  const audioTracksForBuses = params.timelineDoc.tracks.filter((t) => t.kind === 'audio');
  const videoTracksForBuses = params.timelineDoc.tracks.filter((t) => t.kind === 'video');
  const audio_tracks = [...audioTracksForBuses, ...videoTracksForBuses].map((track) => ({
    id: track.id,
    audio_gain: typeof track.audioGain === 'number' ? track.audioGain : 1.0,
    audio_balance: typeof track.audioBalance === 'number' ? track.audioBalance : 0.0,
    audio_muted: Boolean(track.audioMuted),
    audio_solo: Boolean(track.audioSolo),
  }));

  return {
    layers,
    audio_layers:
      params.includeAudio === false
        ? []
        : await buildAudioLayers({
            timelineDoc: params.timelineDoc,
            projectStore: params.projectStore,
            workspaceStore: params.workspaceStore,
            fallbackFormat,
            onWarning: params.onWarning,
          }),
    audio_tracks,
    audio_master_gain: Math.max(0, finite(params.masterGain, 1)),
    audio_master_muted: Boolean(params.masterMuted),
    width: sceneWidth,
    height: sceneHeight,
    preview_scale: params.previewScale ?? 1,
    preview_fps: format.fps,
  };
}
