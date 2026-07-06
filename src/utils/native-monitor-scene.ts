import {
  buildVideoWorkerPayloadFromTracks,
  toWorkerTimelineClips,
  type WorkerPayloadProjectContext,
  type WorkerPayloadWorkspaceContext,
} from '~/timeline/application/workerPayloadBuilder';
import type { WorkerTimelineClip } from '~/types/worker-payload';
import type { ClipTransform, TimelineBlendMode, TimelineDocument } from '~/timeline/types';
import type { BlendMode } from '~/types/generated/native-monitor/BlendMode';
import type { MonitorScene } from '~/types/generated/native-monitor/MonitorScene';
import type { NativeFrameCacheMode } from '~/types/generated/native-monitor/NativeFrameCacheMode';
import type { PreviewSyncMode } from '~/types/generated/native-monitor/PreviewSyncMode';
import type { SceneLayer } from '~/types/generated/native-monitor/SceneLayer';
import type { SceneAudioLayer } from '~/types/generated/native-monitor/SceneAudioLayer';
import type { SceneAudioTrack } from '~/types/generated/native-monitor/SceneAudioTrack';
import type { SceneVideoTrack } from '~/types/generated/native-monitor/SceneVideoTrack';
import type { TimelineFormatInput } from '~/timeline/format';
import { getTimelineFormat, normalizeTimelineFormat } from '~/timeline/format';
import { buildEffectiveAudioClipItems } from '~/utils/audio/track-bus';
import {
  buildCanonicalAudioClipDescriptor,
  toNativeSceneAudioLayer,
  type CanonicalAudioClipDescriptor,
} from '~/utils/audio/audio-clip-descriptor';
import {
  resolveNormalizedAnchor,
  scaleDesignPositionToScene,
  TRANSFORM_DESIGN_BASE,
} from '~/utils/video-editor/clip-layout';
import { normalizeClipSpeed } from '~/utils/video-editor/source-time';
import { buildEffectSpecs } from '~/effects';
import { bakeClipEffectAnimations } from '~/effects/animation-bake';
import { normalizeMediaCachePath } from '~/utils/path';
import { getTransitionManifest } from '~/transitions';
import type { TransitionMode } from '~/transitions/core/registry';
import { buildNativeAudioEffectSpecs } from '~/utils/audio/audio-clip-descriptor';
import {
  resolvePreviewEffectQuality,
  resolvePreviewRenderScale,
  type PreviewEffectQuality,
  type PreviewEffectQualitySetting,
} from '~/utils/preview-effect-quality';
import { isImagePath } from '~/utils/media-types';
import { clampFinite } from '~/utils/math';

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

// The scene DTOs are generated from the Rust IPC structs (`src-tauri/src/
// monitor/scene.rs`) by ts-rs — Rust is the single source of truth for the
// shape. These aliases keep the historical frontend names stable.
export type NativeSceneLayer = SceneLayer;
export type NativeSceneAudioLayer = SceneAudioLayer;
export type NativeAudioTrack = SceneAudioTrack;
export type NativeVideoTrack = SceneVideoTrack;
export type NativeMonitorScene = MonitorScene;

interface NativeMonitorProjectContext extends WorkerPayloadProjectContext {
  activeMonitor?: {
    previewBlurQuality?: PreviewEffectQualitySetting;
  } | null;
  currentProjectName?: string | null;
  getProjectDirHandle: () => Promise<(FileSystemDirectoryHandle & { path?: string }) | null>;
}

interface NativeMonitorWorkspaceContext extends WorkerPayloadWorkspaceContext {
  lastProjectPath?: string | null;
  recentProjects: Array<{
    projectName?: string | null;
    projectPath?: string | null;
  }>;
  userSettings: WorkerPayloadWorkspaceContext['userSettings'] & {
    optimization: {
      nativeMonitorSyncMode?: PreviewSyncMode;
      nativeFrameCacheMode?: NativeFrameCacheMode;
      nativeFrameCacheCustomMb?: number;
    };
  };
}

export interface BuildNativeMonitorSceneParams {
  timelineDoc: TimelineDocument;
  projectStore: NativeMonitorProjectContext;
  workspaceStore: NativeMonitorWorkspaceContext;
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
  isExport?: boolean;
  /** Whether the timeline is currently playing. Auto uses Ultra while paused (and settled). */
  isPlaying?: boolean;
  /**
   * Whether the paused/still frame has settled (no scrub/param activity for the debounce
   * window). Defaults to settled (`true`). The bridge passes `false` during the interactive
   * window so the frame renders at the user motion quality, then rebuilds the scene at `ultra`
   * once it settles. Ignored while playing.
   */
  idleSettled?: boolean;
  /** User-selected preview effect quality. Defaults to 'auto'. */
  previewBlurQuality?: PreviewEffectQualitySetting;
  /** Whether the preview is rendered in the mobile editor. Used by auto quality. */
  isMobile?: boolean;
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
  projectStore: NativeMonitorProjectContext,
  workspaceStore: NativeMonitorWorkspaceContext,
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

function isImageLayer(clip: WorkerTimelineClip): boolean {
  return isImagePath(clip.source?.path ?? '');
}

function isSvgLayer(clip: WorkerTimelineClip): boolean {
  const path = clip.source?.path ?? '';
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return ext === 'svg';
}

function sanitizeVideoSpeed(value: unknown): number {
  return normalizeClipSpeed(value);
}

export function mapTimelineBlendModeToNative(mode: TimelineBlendMode | undefined): BlendMode {
  return mode ?? 'normal';
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

function getEffectiveTransitionIn(clip: WorkerTimelineClip): WorkerTimelineClip['transitionIn'] {
  // An adjacent `transitionOut` is rendered on its *own* clip (over that clip's
  // tail, before the cut) with the next clip pre-rolled as the shader's `to`
  // input — see `transition_out` in `buildBaseLayer` and the native
  // `TransitionEdge::Out` path. It is no longer inherited as the next clip's
  // `transition_in`, which used to push the whole transition past the cut into
  // the start of the next clip. This matches the web compositor.
  return clip.transitionIn;
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
  if (params.mode === 'adjacent' && !params.hasAdjacentPeer) {
    return false;
  }

  const manifest = getTransitionManifest(params.type);
  if (!manifest?.toTransitionSpec) {
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
  const pos = scaleDesignPositionToScene(transform.position, sceneWidth, sceneHeight);

  return {
    x: sceneWidth / 2 + pos.x,
    y: sceneHeight / 2 + pos.y,
    scale_x: Math.abs(clampFinite(transform.scale?.x, 1)),
    scale_y: Math.abs(clampFinite(transform.scale?.y, 1)),
    rotation_deg: clampFinite(transform.rotationDeg, 0),
    anchor_x: anchor.x,
    anchor_y: anchor.y,
    crop_top: transform.crop?.top ?? 0,
    crop_bottom: transform.crop?.bottom ?? 0,
    crop_left: transform.crop?.left ?? 0,
    crop_right: transform.crop?.right ?? 0,
    flip_horizontal: Boolean(transform.flipHorizontal),
    flip_vertical: Boolean(transform.flipVertical),
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
  const pos = scaleDesignPositionToScene(transform.position, sceneWidth, sceneHeight);
  const anchor = resolveNormalizedAnchor(transform.anchor);

  return {
    // Text anchor offset is baked in Rust using the parley-measured natural
    // size. The front-end sends center-of-scene + design-position only.
    x: sceneWidth / 2 + pos.x,
    y: sceneHeight / 2 + pos.y,
    scale_x: Math.abs(clampFinite(transform.scale?.x, 1)),
    scale_y: Math.abs(clampFinite(transform.scale?.y, 1)),
    rotation_deg: clampFinite(transform.rotationDeg, 0),
    anchor_x: anchor.x,
    anchor_y: anchor.y,
    crop_top: transform.crop?.top ?? 0,
    crop_bottom: transform.crop?.bottom ?? 0,
    crop_left: transform.crop?.left ?? 0,
    crop_right: transform.crop?.right ?? 0,
    flip_horizontal: Boolean(transform.flipHorizontal),
    flip_vertical: Boolean(transform.flipVertical),
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
  const pos = scaleDesignPositionToScene(transform.position, sceneWidth, sceneHeight);

  return {
    // Position scales per-axis (design-space), matching media and the web compositor.
    x: sceneWidth / 2 + pos.x + (anchor.x - 0.5) * targetW,
    y: sceneHeight / 2 + pos.y + (anchor.y - 0.5) * targetH,
    scale_x: Math.abs(clampFinite(transform.scale?.x, 1)),
    scale_y: Math.abs(clampFinite(transform.scale?.y, 1)),
    rotation_deg: clampFinite(transform.rotationDeg, 0),
    anchor_x: anchor.x,
    anchor_y: anchor.y,
    crop_top: transform.crop?.top ?? 0,
    crop_bottom: transform.crop?.bottom ?? 0,
    crop_left: transform.crop?.left ?? 0,
    crop_right: transform.crop?.right ?? 0,
    flip_horizontal: Boolean(transform.flipHorizontal),
    flip_vertical: Boolean(transform.flipVertical),
  };
}

async function resolveProjectAbsolutePath(
  projectRelativePath: string,
  projectStore: NativeMonitorProjectContext,
  workspaceStore: NativeMonitorWorkspaceContext,
): Promise<string> {
  const isAbsolute =
    /^[\\/]/.test(projectRelativePath) || /^[a-zA-Z]:[\\/]/.test(projectRelativePath);
  if (isAbsolute) return projectRelativePath;

  try {
    const handle = await projectStore.getProjectDirHandle();
    const projectPath = handle?.path;
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
  isExport?: boolean;
  isPlaying?: boolean;
  idleSettled?: boolean;
  previewBlurQuality?: string;
}): Omit<NativeSceneLayer, 'kind'> {
  const {
    clip,
    sceneWidth,
    sceneHeight,
    z,
    allClips,
    onWarning,
    isExport,
    isPlaying,
    idleSettled,
    previewBlurQuality,
  } = params;
  const startUs = clip.timelineRange.startUs;
  const durationUs = clip.timelineRange.durationUs;
  const sourceStartUs = clip.sourceRange.startUs;
  const sourceDurationUs = clip.sourceRange.durationUs;

  const transition_in = (() => {
    const effectiveTransitionIn = getEffectiveTransitionIn(clip);
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
      const manifest = getTransitionManifest(type);
      const spec = manifest?.toTransitionSpec
        ? manifest.toTransitionSpec(
            effectiveTransitionIn.params ?? {},
            effectiveTransitionIn.durationUs / 1_000_000,
            { isExport, isPlaying, idleSettled, previewBlurQuality },
          )
        : undefined;

      return {
        type,
        duration_sec: effectiveTransitionIn.durationUs / 1_000_000,
        curve: effectiveTransitionIn.curve,
        from_layer_id: fromClip?.id,
        mode,
        spec,
      };
    }
    return undefined;
  })();

  const transition_out = (() => {
    if (clip.transitionOut && clip.transitionOut.durationUs > 0) {
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
      const manifest = getTransitionManifest(type);
      const spec = manifest?.toTransitionSpec
        ? manifest.toTransitionSpec(
            clip.transitionOut.params ?? {},
            clip.transitionOut.durationUs / 1_000_000,
            { isExport, isPlaying, idleSettled, previewBlurQuality },
          )
        : undefined;

      return {
        type,
        duration_sec: clip.transitionOut.durationUs / 1_000_000,
        curve: clip.transitionOut.curve,
        from_layer_id: toClip?.id,
        mode,
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
    // Full media duration (not the trimmed range): lets the native renderer play
    // the outgoing clip's tail/handle during a transition instead of freezing on
    // the trimmed out-point, matching the web compositor. Omitted when unknown.
    source_duration_sec:
      typeof clip.sourceDurationUs === 'number' && clip.sourceDurationUs > 0
        ? clip.sourceDurationUs / 1_000_000
        : undefined,
    speed: sanitizeVideoSpeed(clip.speed),
    freeze_frame_source_sec:
      typeof clip.freezeFrameSourceUs === 'number'
        ? Math.max(0, clip.freezeFrameSourceUs) / 1_000_000
        : undefined,
    source_orientation: String(clip.sourceOrientation ?? 'auto'),
    z,
    opacity: Math.max(0, Math.min(1, clampFinite(clip.opacity, 1))),
    blend_mode: mapTimelineBlendModeToNative(clip.blendMode),
    effects: buildEffectSpecs(clip.effects) ?? [],
    transform: buildNativeTransform(clip.transform, sceneWidth, sceneHeight),
    animations: clip.animations,
    baked_effects: bakeClipEffectAnimations(clip.effects, clip.animations),
    transition_in,
    transition_out,
    // Only text/shape layers snap; other kinds override this below.
    snap_to_pixel_grid: false,
  };
}

function resolveNativePreviewEffectQuality(
  params: Pick<
    BuildNativeMonitorSceneParams,
    'isExport' | 'isPlaying' | 'previewBlurQuality' | 'isMobile' | 'idleSettled'
  > & {
    width: number;
    height: number;
    fps: number;
  },
): PreviewEffectQuality {
  // Resolve the tier from the *full* scene resolution: the tier is the single dial that
  // then derives both the effect sample budget and (in auto mode) the render scale, so it
  // must not be fed the already-scaled size — that would be a circular dependency.
  return resolvePreviewEffectQuality({
    setting: params.previewBlurQuality,
    isExport: params.isExport,
    isPlaying: params.isPlaying,
    idleSettled: params.idleSettled,
    isMobile: params.isMobile,
    width: params.width,
    height: params.height,
    fps: params.fps,
  });
}

async function buildAudioLayers(params: {
  timelineDoc: TimelineDocument;
  projectStore: NativeMonitorProjectContext;
  workspaceStore: NativeMonitorWorkspaceContext;
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
  // The doc's own stored format is a creation-time snapshot; when the timeline
  // follows project settings the effective format is supplied via `fallbackFormat`
  // (the resolved `timelineStore.timelineFormat`). Scene dimensions and fps MUST
  // come from that effective format, otherwise the monitor/export composes at the
  // stale snapshot size while clip transforms scale against the (correct) effective
  // one — wrong resolution/fps and aspect distortion after a project-settings change.
  const docFormat = getTimelineFormat(params.timelineDoc);
  const fallbackFormat = params.fallbackFormat
    ? normalizeTimelineFormat(params.fallbackFormat, docFormat)
    : docFormat;
  const sceneWidth = fallbackFormat.width;
  const sceneHeight = fallbackFormat.height;
  const proxy: ProxyResolution = {
    useProxyInMonitor: params.useProxyInMonitor ?? false,
    existingProxies: params.existingProxies,
    getProxyNativePath: params.getProxyNativePath,
  };
  const nestedDocCache = new Map<string, TimelineDocument>();
  const previewBlurQuality = resolveNativePreviewEffectQuality({
    ...params,
    previewBlurQuality:
      params.previewBlurQuality ?? params.projectStore.activeMonitor?.previewBlurQuality,
    width: sceneWidth,
    height: sceneHeight,
    fps: fallbackFormat.fps,
  });
  // Render scale = the user's "Preview Resolution" menu choice (`previewScale` > 0 pins it),
  // or, in Auto mode, the scale derived from the steady MOTION quality tier. It MUST be
  // independent of play/pause and of the effect-quality settle window: the native monitor
  // drops & re-decodes every video runtime whenever `preview_scale` changes
  // (monitor/runtime.rs ~289), so a play/pause or scrub-driven scale flip would black-frame
  // the preview and stall playback start. The "still frame ⇒ full res" bump was removed for
  // exactly this reason — pick "1/1" in the menu for a crisp paused frame. Only the (cheap)
  // effect/transition sample budgets vary dynamically; geometric scale stays constant.
  const scaleQuality = resolvePreviewEffectQuality({
    setting: params.previewBlurQuality ?? params.projectStore.activeMonitor?.previewBlurQuality,
    isPlaying: true, // force the steady motion tier so the scale never flips on pause
    isMobile: params.isMobile,
    width: sceneWidth,
    height: sceneHeight,
    fps: fallbackFormat.fps,
  });
  const previewScale = resolvePreviewRenderScale({
    manualScale: params.previewScale,
    quality: scaleQuality,
    isExport: params.isExport,
  });
  const builtVideo = await buildVideoWorkerPayloadFromTracks({
    tracks: params.timelineDoc.tracks,
    projectStore: params.projectStore,
    workspaceStore: params.workspaceStore,
    masterEffects: params.timelineDoc.metadata?.fastcat?.masterEffects,
    fallbackFormat,
    onWarning: params.onWarning,
    nestedDocCache,
  });
  const orderedTracks = [...builtVideo.tracks].sort(
    (a, b) => a.layer - b.layer || a.id.localeCompare(b.id),
  );
  const trackOrderById = new Map(orderedTracks.map((track, index) => [track.id, index]));
  const zStride = builtVideo.clips.length + 1;

  const layers: NativeSceneLayer[] = [];
  for (const [index, clip] of builtVideo.clips.entries()) {
    if (clip.clipType === 'hud') continue;
    const trackOrder = clip.trackId ? (trackOrderById.get(clip.trackId) ?? 0) : 0;
    const z = trackOrder * zStride + index;
    const base = buildBaseLayer({
      clip,
      sceneWidth,
      sceneHeight,
      z,
      allClips: builtVideo.clips,
      onWarning: params.onWarning,
      isExport: params.isExport,
      isPlaying: params.isPlaying,
      idleSettled: params.idleSettled,
      previewBlurQuality,
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
        snap_to_pixel_grid: Boolean(clip.snapToPixelGrid),
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
        snap_to_pixel_grid: Boolean(clip.snapToPixelGrid),
      });
    }
  }

  const audioTracksForBuses = params.timelineDoc.tracks.filter((t) => t.kind === 'audio');
  const videoTracksForBuses = params.timelineDoc.tracks.filter((t) => t.kind === 'video');
  // The bus carries only the track GAIN (a scalar that composes with the layer's
  // clip-only gain to reproduce the web merge). It deliberately does NOT carry
  // the track BALANCE: the track balance is already folded additively into each
  // layer's merged balance (see toNativeSceneAudioLayer), so re-panning on the
  // bus would cascade two equal-power pans and diverge from the web's single
  // additive StereoPanner. Hence `audio_balance: 0` (identity pan) here.
  //
  // Muted/soloed tracks (and disabled/clip-muted items) are already filtered out
  // upstream by buildEffectiveAudioClipItems. Keep the native bus flags neutral
  // so there is one authoritative solo/mute implementation.
  const audio_tracks = [...audioTracksForBuses, ...videoTracksForBuses].map((track) => ({
    id: track.id,
    audio_gain: typeof track.audioGain === 'number' ? track.audioGain : 1.0,
    audio_balance: 0,
    audio_muted: false,
    audio_solo: false,
  }));

  const optimization = params.workspaceStore.userSettings.optimization;

  return {
    layers,
    video_tracks: orderedTracks.map((track, index) => ({
      id: track.id,
      z: index,
      layer_ids: builtVideo.clips
        .filter((clip) => clip.trackId === track.id)
        .map((clip) => clip.id),
      opacity: Math.max(0, Math.min(1, clampFinite(track.opacity, 1))),
      blend_mode: mapTimelineBlendModeToNative(track.blendMode),
      effects: buildEffectSpecs(track.effects) ?? [],
    })),
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
    audio_master_gain: Math.max(0, clampFinite(params.masterGain, 1)),
    audio_master_muted: Boolean(params.masterMuted),
    audio_master_effects: buildNativeAudioEffectSpecs(
      params.timelineDoc.metadata?.fastcat?.masterEffects,
    ),
    width: sceneWidth,
    height: sceneHeight,
    preview_scale: previewScale,
    preview_fps: fallbackFormat.fps,
    preview_sync_mode: params.syncMode ?? optimization.nativeMonitorSyncMode ?? 'balanced',
    preview_effect_quality: previewBlurQuality,
    frame_cache_mode: optimization.nativeFrameCacheMode ?? 'auto',
    frame_cache_custom_mb: Math.max(0, Math.round(optimization.nativeFrameCacheCustomMb ?? 0)),
    master_effects: buildEffectSpecs(params.timelineDoc.metadata?.fastcat?.masterEffects) ?? [],
  };
}
