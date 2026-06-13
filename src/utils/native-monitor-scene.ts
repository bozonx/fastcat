import {
  buildVideoWorkerPayloadFromTracks,
  toWorkerTimelineClips,
} from '~/composables/timeline/export';
import type { WorkerTimelineClip } from '~/composables/timeline/export/types';
import type { useProjectStore } from '~/stores/project.store';
import type { useWorkspaceStore } from '~/stores/workspace.store';
import type { ClipTransform, TimelineBlendMode, TimelineDocument } from '~/timeline/types';
import type { BlendMode } from '../../src-tauri/bindings/BlendMode';
import type { MonitorScene } from '~/types/generated/native-monitor/MonitorScene';
import type { SceneLayer } from '~/types/generated/native-monitor/SceneLayer';
import type { SceneAudioLayer } from '~/types/generated/native-monitor/SceneAudioLayer';
import type { SceneAudioTrack } from '~/types/generated/native-monitor/SceneAudioTrack';
import type { TimelineFormatInput } from '~/timeline/format';
import { getTimelineFormat } from '~/timeline/format';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import {
  buildCanonicalAudioClipDescriptor,
  toNativeSceneAudioLayer,
  type CanonicalAudioClipDescriptor,
} from '~/utils/audio/audio-clip-descriptor';
import { resolveNormalizedAnchor, TRANSFORM_DESIGN_BASE } from '~/utils/video-editor/clip-layout';
import { normalizeClipSpeed } from '~/utils/video-editor/source-time';
import type { TauriDirectoryHandle } from '~/stores/workspace/provider/tauri-handle';
import { buildEffectSpecs } from '~/effects';
import { normalizeMediaCachePath } from '~/utils/media-cache-path';
import { getTauriTransitionManifest } from '~/transitions/tauri/manifests';
import type { TransitionMode } from '~/transitions/core/registry';
import { buildNativeAudioEffectSpecs } from '~/utils/audio/audio-clip-descriptor';

export { buildNativeAudioEffectSpecs };

// Preload Tauri path helper so we don't dynamic-import it per clip.
let _tauriJoin: ((...paths: string[]) => Promise<string>) | null = null;
async function getTauriJoin() {
  if (!_tauriJoin) {
    const { join } = await import('@tauri-apps/api/path');
    _tauriJoin = join;
  }
  return _tauriJoin;
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);
const SVG_EXT = new Set(['svg']);

// The scene DTOs are generated from the Rust IPC structs (`src-tauri/src/
// monitor/scene.rs`) by ts-rs — Rust is the single source of truth for the
// shape. These aliases keep the historical frontend names stable.
export type NativeSceneLayer = SceneLayer;
export type NativeSceneAudioLayer = SceneAudioLayer;
export type NativeAudioTrack = SceneAudioTrack;
export type NativeMonitorScene = MonitorScene;

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
  /** When true, media clips that have a proxy are decoded from the proxy. */
  useProxyInMonitor?: boolean;
  /** Source paths (project-relative) that have a generated proxy. */
  existingProxies?: Set<string>;
  /** Resolves a clip's proxy to its absolute on-disk path, or null if none. */
  getProxyNativePath?: (projectRelativePath: string) => Promise<string | null>;
  /** Hardcoded sync mode override (e.g. mobile always uses 'balanced'). */
  syncMode?: 'smooth' | 'balanced' | 'strict';
}

interface ProxyResolution {
  useProxyInMonitor: boolean;
  existingProxies?: Set<string>;
  getProxyNativePath?: (projectRelativePath: string) => Promise<string | null>;
}

/**
 * Resolve a media clip's project-relative source path to the absolute path the
 * native engine should decode. When the monitor proxy toggle is on and a proxy
 * exists for this source, the proxy's absolute path is returned; otherwise the
 * original source resolves as usual.
 */
async function resolveMediaSourceAbsolutePath(
  projectRelativePath: string,
  projectStore: ReturnType<typeof useProjectStore>,
  workspaceStore: ReturnType<typeof useWorkspaceStore>,
  proxy: ProxyResolution | undefined,
): Promise<string> {
  if (
    proxy?.useProxyInMonitor &&
    proxy.getProxyNativePath &&
    proxy.existingProxies?.has(normalizeMediaCachePath(projectRelativePath))
  ) {
    const proxyPath = await proxy.getProxyNativePath(projectRelativePath);
    if (proxyPath) return proxyPath;
  }
  return resolveProjectAbsolutePath(projectRelativePath, projectStore, workspaceStore);
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
  return normalizeClipSpeed(value);
}

export function mapTimelineBlendModeToNative(mode: TimelineBlendMode | undefined): BlendMode {
  switch (mode) {
    case 'color-dodge':
      return 'color_dodge';
    case 'color-burn':
      return 'color_burn';
    case 'hard-light':
      return 'hard_light';
    case 'soft-light':
      return 'soft_light';
    default:
      return mode ?? 'normal';
  }
}

function findPreviousAdjacentClip(
  clip: WorkerTimelineClip,
  allClips: WorkerTimelineClip[],
): WorkerTimelineClip | undefined {
  return allClips
    .filter((candidate) => {
      if (candidate.trackId !== clip.trackId || candidate.id === clip.id) {
        return false;
      }
      const candidateEndUs = candidate.timelineRange.startUs + candidate.timelineRange.durationUs;
      return (
        candidate.timelineRange.startUs < clip.timelineRange.startUs &&
        candidateEndUs >= clip.timelineRange.startUs - 1_000
      );
    })
    .sort((a, b) => {
      const aEndUs = a.timelineRange.startUs + a.timelineRange.durationUs;
      const bEndUs = b.timelineRange.startUs + b.timelineRange.durationUs;
      return bEndUs - aEndUs;
    })[0];
}

function findNextAdjacentClip(
  clip: WorkerTimelineClip,
  allClips: WorkerTimelineClip[],
): WorkerTimelineClip | undefined {
  const clipEndUs = clip.timelineRange.startUs + clip.timelineRange.durationUs;
  return allClips
    .filter((candidate) => {
      if (candidate.trackId !== clip.trackId || candidate.id === clip.id) {
        return false;
      }
      return (
        candidate.timelineRange.startUs > clip.timelineRange.startUs &&
        candidate.timelineRange.startUs <= clipEndUs + 1_000
      );
    })
    .sort((a, b) => a.timelineRange.startUs - b.timelineRange.startUs)[0];
}

/**
 * An adjacent-mode `transitionOut` is rendered by the *next* clip's inherited
 * `transition_in` (see `getEffectiveTransitionIn`), where it becomes a real
 * shader crossfade over this clip's held frame. Emitting it on this clip too
 * would double-apply (for dissolve: an opacity fade-out that zeroes the very
 * from-frame the next clip crossfades from). So it is "consumed" exactly when
 * the next adjacent clip would inherit it.
 */
function isTransitionOutConsumedByNextClip(
  clip: WorkerTimelineClip,
  allClips: WorkerTimelineClip[],
): boolean {
  const out = clip.transitionOut;
  if (!out || (out.mode ?? 'transparent') !== 'adjacent') {
    return false;
  }
  const next = findNextAdjacentClip(clip, allClips);
  return Boolean(next && !next.transitionIn);
}

function getEffectiveTransitionIn(
  clip: WorkerTimelineClip,
  allClips: WorkerTimelineClip[],
): WorkerTimelineClip['transitionIn'] {
  if (clip.transitionIn) {
    return clip.transitionIn;
  }

  const previous = findPreviousAdjacentClip(clip, allClips);
  const previousOut = previous?.transitionOut;
  if (previousOut && (previousOut.mode ?? 'transparent') === 'adjacent') {
    return previousOut;
  }

  return undefined;
}

function getTransitionMode(
  transition: WorkerTimelineClip['transitionIn'] | WorkerTimelineClip['transitionOut'],
): TransitionMode {
  return transition?.mode ?? 'transparent';
}

function isNativeTransitionSupported(params: {
  type: string;
  mode: TransitionMode;
  hasAdjacentPeer: boolean;
}): boolean {
  if (params.type === 'dissolve') {
    return true;
  }

  if (!params.hasAdjacentPeer) {
    return false;
  }

  const manifest = getTauriTransitionManifest(params.type);
  if (!manifest?.toTauriSpec) {
    return false;
  }

  return (manifest.supportedModes ?? ['adjacent']).includes(params.mode);
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
    crop_top: transform.crop?.top ?? 0,
    crop_bottom: transform.crop?.bottom ?? 0,
    crop_left: transform.crop?.left ?? 0,
    crop_right: transform.crop?.right ?? 0,
  };
}

function buildNativeTextTransform(params: {
  transform: ClipTransform | undefined;
  sceneWidth: number;
  sceneHeight: number;
}) {
  const { transform, sceneWidth, sceneHeight } = params;
  if (!transform) return undefined;

  // Position is a design-space offset (1920x1080 base) scaled per-axis to the
  // scene resolution — identical to media (`buildNativeTransform`) and the web
  // compositor (`LayoutApplier.applyScreenSpaceLayout`). Using a uniform min()
  // here desynced text/shape placement from media on non-16:9 outputs.
  const posX = finite(transform.position?.x, 0) * (sceneWidth / TRANSFORM_DESIGN_BASE.width);
  const posY = finite(transform.position?.y, 0) * (sceneHeight / TRANSFORM_DESIGN_BASE.height);
  const anchor = resolveNormalizedAnchor(transform.anchor);

  return {
    // Text anchor offset is baked in Rust using the parley-measured natural
    // size. The front-end sends center-of-scene + design-position only.
    x: sceneWidth / 2 + posX,
    y: sceneHeight / 2 + posY,
    scale_x: finite(transform.scale?.x, 1),
    scale_y: finite(transform.scale?.y, 1),
    rotation_deg: finite(transform.rotationDeg, 0),
    anchor_x: anchor.x,
    anchor_y: anchor.y,
    crop_top: transform.crop?.top ?? 0,
    crop_bottom: transform.crop?.bottom ?? 0,
    crop_left: transform.crop?.left ?? 0,
    crop_right: transform.crop?.right ?? 0,
  };
}

function buildNativeShapeTransform(params: {
  transform: ClipTransform | undefined;
  strokeWidth: number | undefined;
  sceneWidth: number;
  sceneHeight: number;
}) {
  const { transform, strokeWidth, sceneWidth, sceneHeight } = params;
  if (!transform) return undefined;
  const anchor = resolveNormalizedAnchor(transform.anchor);
  const renderScale = Math.min(
    sceneWidth / TRANSFORM_DESIGN_BASE.width,
    sceneHeight / TRANSFORM_DESIGN_BASE.height,
  );
  const size = Math.min(sceneWidth, sceneHeight) * 0.8;
  // Stroke width is a design-space value: scale it with the shape body (which is
  // a fixed fraction of the frame) so the outline keeps its relative thickness at
  // any resolution. Must match the native `build_virtual_kind` shape branch and
  // the web `ShapeRenderer`/`LayoutApplier`.
  const sW = (strokeWidth ?? 0) * renderScale;
  const targetW = Math.max(1, Math.ceil(size + sW * 2));
  const targetH = Math.max(1, Math.ceil(size + sW * 2));

  return {
    // Position scales per-axis (design-space), matching media and the web compositor.
    x:
      sceneWidth / 2 +
      finite(transform.position?.x, 0) * (sceneWidth / TRANSFORM_DESIGN_BASE.width) +
      (anchor.x - 0.5) * targetW,
    y:
      sceneHeight / 2 +
      finite(transform.position?.y, 0) * (sceneHeight / TRANSFORM_DESIGN_BASE.height) +
      (anchor.y - 0.5) * targetH,
    scale_x: finite(transform.scale?.x, 1),
    scale_y: finite(transform.scale?.y, 1),
    rotation_deg: finite(transform.rotationDeg, 0),
    anchor_x: anchor.x,
    anchor_y: anchor.y,
    crop_top: transform.crop?.top ?? 0,
    crop_bottom: transform.crop?.bottom ?? 0,
    crop_left: transform.crop?.left ?? 0,
    crop_right: transform.crop?.right ?? 0,
  };
}

async function resolveProjectAbsolutePath(
  projectRelativePath: string,
  projectStore: ReturnType<typeof useProjectStore>,
  workspaceStore: ReturnType<typeof useWorkspaceStore>,
): Promise<string> {
  const isAbsolute =
    /^[\\/]/.test(projectRelativePath) || /^[a-zA-Z]:[\\/]/.test(projectRelativePath);
  if (isAbsolute) return projectRelativePath;

  try {
    const handle = await projectStore.getProjectDirHandle();
    const projectPath = (handle as unknown as TauriDirectoryHandle | null)?.path;
    if (projectPath) {
      const join = await getTauriJoin();
      return await join(projectPath, projectRelativePath);
    }
  } catch {
    // ignore, try fallback
  }

  // Fallback for projects outside the standard projectsRoot where
  // currentProjectDirHandle may be null (e.g. after hot-reload) and
  // projectsHandle cannot locate the project by name.
  try {
    const fallbackPath =
      workspaceStore.lastProjectPath ??
      workspaceStore.recentProjects.find(
        (p) => p.projectName === projectStore.currentProjectName && p.projectPath,
      )?.projectPath;
    if (fallbackPath) {
      const join = await getTauriJoin();
      return await join(fallbackPath, projectRelativePath);
    }
  } catch {
    // ignore
  }

  return projectRelativePath;
}

function buildBaseLayer(params: {
  clip: WorkerTimelineClip;
  sceneWidth: number;
  sceneHeight: number;
  z: number;
  allClips: WorkerTimelineClip[];
  onWarning?: (message: string) => void;
}): Omit<NativeSceneLayer, 'kind'> {
  const { clip, sceneWidth, sceneHeight, z, allClips, onWarning } = params;
  const startUs = clip.timelineRange.startUs;
  const durationUs = clip.timelineRange.durationUs;
  const sourceStartUs = clip.sourceRange.startUs;
  const sourceDurationUs = clip.sourceRange.durationUs;

  const transition_in = (() => {
    const effectiveTransitionIn = getEffectiveTransitionIn(clip, allClips);
    if (effectiveTransitionIn && effectiveTransitionIn.durationUs > 0) {
      const type = effectiveTransitionIn.type;
      const mode = getTransitionMode(effectiveTransitionIn);
      const fromClip = mode === 'adjacent' ? findPreviousAdjacentClip(clip, allClips) : undefined;
      if (
        !isNativeTransitionSupported({
          type,
          mode,
          hasAdjacentPeer: Boolean(fromClip),
        })
      ) {
        onWarning?.(
          `Transition "${type}" on clip "${clip.id}" is not supported by the native Tauri renderer in "${mode}" mode.`,
        );
        return undefined;
      }
      const manifest = getTauriTransitionManifest(type);
      const spec = manifest?.toTauriSpec
        ? manifest.toTauriSpec(effectiveTransitionIn.params ?? {})
        : undefined;

      return {
        type,
        duration_sec: effectiveTransitionIn.durationUs / 1_000_000,
        curve: effectiveTransitionIn.curve,
        from_layer_id: fromClip?.id,
        spec,
      };
    }
    return undefined;
  })();

  const transition_out = (() => {
    if (
      clip.transitionOut &&
      clip.transitionOut.durationUs > 0 &&
      !isTransitionOutConsumedByNextClip(clip, allClips)
    ) {
      const type = clip.transitionOut.type;
      const mode = getTransitionMode(clip.transitionOut);
      const toClip = mode === 'adjacent' ? findNextAdjacentClip(clip, allClips) : undefined;
      if (
        !isNativeTransitionSupported({
          type,
          mode,
          hasAdjacentPeer: Boolean(toClip),
        })
      ) {
        onWarning?.(
          `Transition "${type}" on clip "${clip.id}" is not supported by the native Tauri renderer in "${mode}" mode.`,
        );
        return undefined;
      }
      const manifest = getTauriTransitionManifest(type);
      const spec = manifest?.toTauriSpec
        ? manifest.toTauriSpec(clip.transitionOut.params ?? {})
        : undefined;

      return {
        type,
        duration_sec: clip.transitionOut.durationUs / 1_000_000,
        curve: clip.transitionOut.curve,
        spec,
      };
    }
    return undefined;
  })();

  return {
    id: clip.id,
    // `path` is required by the generated SceneLayer; media layers override it
    // below, virtual layers (text/shape/background) leave it empty.
    path: '',
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
    blend_mode: mapTimelineBlendModeToNative(clip.blendMode),
    effects: buildEffectSpecs(clip.effects) ?? [],
    transform: buildNativeTransform(clip.transform, sceneWidth, sceneHeight),
    transition_in,
    transition_out,
  };
}

async function buildAudioLayers(params: {
  timelineDoc: TimelineDocument;
  projectStore: ReturnType<typeof useProjectStore>;
  workspaceStore: ReturnType<typeof useWorkspaceStore>;
  fallbackFormat: TimelineFormatInput;
  onWarning?: (message: string) => void;
  proxy?: ProxyResolution;
}): Promise<NativeSceneAudioLayer[]> {
  const audioTracks = params.timelineDoc.tracks.filter((track) => track.kind === 'audio');
  const videoTracks = params.timelineDoc.tracks.filter((track) => track.kind === 'video');
  const effectiveAudioResult = buildEffectiveAudioClipItems({
    audioTracks,
    videoTracks,
    masterEffects: params.timelineDoc.metadata?.fastcat?.masterEffects,
  });
  const clips = await toWorkerTimelineClips(
    effectiveAudioResult.items,
    params.projectStore,
    params.workspaceStore,
    {
      trackKind: 'audio',
      fallbackFormat: params.fallbackFormat,
      onWarning: params.onWarning,
    },
  );

  // Build descriptors first so same-track neighbours can be resolved: the native
  // mixer needs prev/next to reproduce de-click, adjacent-transition crossfades
  // and curve inheritance (see toNativeSceneAudioLayer).
  const descriptors: CanonicalAudioClipDescriptor[] = [];
  for (const clip of clips) {
    if (clip.clipType !== 'media') continue;
    const path = clip.source?.path;
    if (!path) continue;
    const durationUs = clip.timelineRange.durationUs;
    if (durationUs <= 0) continue;

    descriptors.push(
      buildCanonicalAudioClipDescriptor({
        clip,
        sourcePath: await resolveMediaSourceAbsolutePath(
          path,
          params.projectStore,
          params.workspaceStore,
          params.proxy,
        ),
      }),
    );
  }

  // Adjacency: per track (effective trackId), ordered by timeline start.
  const byTrack = new Map<string, CanonicalAudioClipDescriptor[]>();
  for (const descriptor of descriptors) {
    const key = descriptor.trackId ?? '';
    const list = byTrack.get(key);
    if (list) list.push(descriptor);
    else byTrack.set(key, [descriptor]);
  }
  const prevOf = new Map<CanonicalAudioClipDescriptor, CanonicalAudioClipDescriptor | null>();
  const nextOf = new Map<CanonicalAudioClipDescriptor, CanonicalAudioClipDescriptor | null>();
  for (const list of byTrack.values()) {
    list.sort((a, b) => a.startUs - b.startUs);
    for (let i = 0; i < list.length; i++) {
      prevOf.set(list[i]!, i > 0 ? list[i - 1]! : null);
      nextOf.set(list[i]!, i < list.length - 1 ? list[i + 1]! : null);
    }
  }

  return descriptors.map((descriptor) =>
    toNativeSceneAudioLayer({
      descriptor,
      previous: prevOf.get(descriptor) ?? null,
      next: nextOf.get(descriptor) ?? null,
    }),
  );
}

export async function buildNativeMonitorScene(
  params: BuildNativeMonitorSceneParams,
): Promise<NativeMonitorScene> {
  const format = getTimelineFormat(params.timelineDoc);
  const fallbackFormat = params.fallbackFormat ?? format;
  const sceneWidth = format.width;
  const sceneHeight = format.height;
  const proxy: ProxyResolution = {
    useProxyInMonitor: params.useProxyInMonitor ?? false,
    existingProxies: params.existingProxies,
    getProxyNativePath: params.getProxyNativePath,
  };
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
    if (clip.clipType === 'hud') continue;
    const z = clip.layer * 1000 + index;
    const base = buildBaseLayer({
      clip,
      sceneWidth,
      sceneHeight,
      z,
      allClips: builtVideo.clips,
      onWarning: params.onWarning,
    });

    if (clip.clipType === 'adjustment') {
      layers.push({
        ...base,
        kind: 'adjustment',
      });
      continue;
    }

    if (clip.clipType === 'media') {
      const path = clip.source?.path;
      if (!path) continue;
      layers.push({
        ...base,
        kind: isSvgLayer(clip) ? 'svg' : isImageLayer(clip) ? 'image' : 'video',
        path: await resolveMediaSourceAbsolutePath(
          path,
          params.projectStore,
          params.workspaceStore,
          proxy,
        ),
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
      const textTransform = buildNativeTextTransform({
        transform: clip.transform,
        sceneWidth,
        sceneHeight,
      });
      layers.push({
        ...base,
        transform: textTransform,
        kind: 'text',
        text: clip.text ?? '',
        style: clip.style,
      });
      continue;
    }

    if (clip.clipType === 'shape') {
      const shapeTransform = buildNativeShapeTransform({
        transform: clip.transform,
        strokeWidth: clip.strokeWidth,
        sceneWidth,
        sceneHeight,
      });
      layers.push({
        ...base,
        transform: shapeTransform,
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

  const optimization = params.workspaceStore.userSettings.optimization;

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
            proxy,
          }),
    audio_tracks,
    audio_master_gain: Math.max(0, finite(params.masterGain, 1)),
    audio_master_muted: Boolean(params.masterMuted),
    audio_master_effects: buildNativeAudioEffectSpecs(
      params.timelineDoc.metadata?.fastcat?.masterEffects,
    ),
    width: sceneWidth,
    height: sceneHeight,
    preview_scale: params.previewScale ?? 1,
    preview_fps: format.fps,
    preview_sync_mode: params.syncMode ?? optimization.nativeMonitorSyncMode,
    frame_cache_mode: optimization.nativeFrameCacheMode ?? 'auto',
    frame_cache_custom_mb: Math.max(0, Math.round(optimization.nativeFrameCacheCustomMb ?? 0)),
    master_effects: buildEffectSpecs(params.timelineDoc.metadata?.fastcat?.masterEffects) ?? [],
  };
}
