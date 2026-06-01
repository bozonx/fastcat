import { createDevLogger } from '~/utils/dev-logger';
import { useProjectStore } from '~/stores/project.store';
import { useWorkspaceStore } from '~/stores/workspace.store';
import {
  isClipItem,
  isSourceClipItem,
  type ShapeConfig,
  type TimelineClipItem,
  type TimelineDocument,
  type TimelineShapeClipItem,
  type TimelineTextClipItem,
} from '~/timeline/types';
import { selectTimelineDurationUs } from '~/timeline/selectors';
import { cloneValue } from '~/utils/clone';
import { isTauriRuntime } from '~/utils/runtime';
import { getTimelineFormat } from '~/timeline/format';
import { nativeRenderTimelineFrameWebp } from '~/utils/tauri-media-processing';
import { fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';
import { resolveNormalizedAnchor, TRANSFORM_DESIGN_BASE } from '~/utils/video-editor/clip-layout';
const log = createDevLogger('timeline-thumbnail');

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);
const SVG_EXT = new Set(['svg']);

export interface NativeSceneLayer {
  id: string;
  kind: 'video' | 'image' | 'svg' | 'text' | 'shape' | 'background';
  path?: string;
  timeline_start_sec: number;
  timeline_end_sec: number;
  source_start_sec: number;
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
}

export interface NativeMonitorScene {
  layers: NativeSceneLayer[];
  width: number;
  height: number;
  preview_scale?: number;
  preview_fps?: number;
}

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i >= 0 ? path.slice(i + 1) : '';
}

function isImageLayer(clip: TimelineClipItem): boolean {
  if (clip.isImage) return true;
  return IMAGE_EXT.has(extOf(clip.source?.path ?? '').toLowerCase());
}

function isSvgLayer(clip: TimelineClipItem): boolean {
  return SVG_EXT.has(extOf(clip.source?.path ?? '').toLowerCase());
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function buildNativeTransform(item: TimelineClipItem, sceneWidth: number, sceneHeight: number) {
  const transform = item.transform;
  if (!transform) return undefined;
  const anchor = resolveNormalizedAnchor(transform.anchor);
  return {
    x: sceneWidth / 2 + finite(transform.position?.x, 0) * (sceneWidth / TRANSFORM_DESIGN_BASE.width),
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

async function resolveProjectAbsolutePath(projectRelativePath: string): Promise<string> {
  const projectStore = useProjectStore();
  const handle = await projectStore.getProjectDirHandle();
  const projectPath = (handle as { path?: string } | null)?.path;
  if (!projectPath) return projectRelativePath;
  const { join } = await import('@tauri-apps/api/path');
  return await join(projectPath, projectRelativePath);
}

export async function buildNativeMonitorScene(
  timelineDoc: TimelineDocument,
): Promise<NativeMonitorScene> {
  const format = getTimelineFormat(timelineDoc);
  const sceneWidth = format.width;
  const sceneHeight = format.height;
  const visibleVideoTracks = timelineDoc.tracks.filter(
    (track) => track.kind === 'video' && !track.videoHidden,
  );
  const videoTrackLayerById = new Map<string, number>();
  visibleVideoTracks.forEach((track, index) => {
    videoTrackLayerById.set(track.id, visibleVideoTracks.length - 1 - index);
  });

  const layers: NativeSceneLayer[] = [];
  for (const track of visibleVideoTracks) {
    const trackLayer = videoTrackLayerById.get(track.id) ?? 0;
    for (const item of track.items) {
      if (!isClipItem(item) || item.disabled) continue;
      const z = trackLayer * 1000 + Math.round(finite(item.layer, 0));
      const base = {
        id: item.id,
        timeline_start_sec: item.timelineRange.startUs / 1_000_000,
        timeline_end_sec: (item.timelineRange.startUs + item.timelineRange.durationUs) / 1_000_000,
        source_start_sec: item.sourceRange.startUs / 1_000_000,
        z,
        opacity: item.opacityActive === false ? 1 : (item.opacity ?? 1),
        blend_mode: item.blendModeActive === false ? 'normal' : (item.blendMode ?? 'normal'),
        transform: buildNativeTransform(item, sceneWidth, sceneHeight),
      };

      if (isSourceClipItem(item)) {
        const path = item.source?.path;
        if (!path) continue;
        layers.push({
          ...base,
          kind: isSvgLayer(item) ? 'svg' : isImageLayer(item) ? 'image' : 'video',
          path: await resolveProjectAbsolutePath(path),
        });
      } else if (item.clipType === 'background') {
        layers.push({ ...base, kind: 'background', background_color: item.backgroundColor });
      } else if (item.clipType === 'text') {
        layers.push({
          ...base,
          kind: 'text',
          text: (item as TimelineTextClipItem).text,
          style: (item as TimelineTextClipItem).style,
        });
      } else if (item.clipType === 'shape') {
        const shape = item as TimelineShapeClipItem;
        layers.push({
          ...base,
          kind: 'shape',
          shape_type: shape.shapeType,
          fill_color: shape.fillColor,
          stroke_color: shape.strokeColor,
          stroke_width: shape.strokeWidth,
          shape_config: shape.shapeConfig,
        });
      }
    }
  }

  return {
    layers,
    width: sceneWidth,
    height: sceneHeight,
    preview_scale: 1,
    preview_fps: format.fps,
  };
}

export function generateTimelineThumbnail(params: {
  timelinePath: string;
  timelineDoc: TimelineDocument;
}): void {
  const projectStore = useProjectStore();
  const workspaceStore = useWorkspaceStore();

  if (!projectStore.currentProjectId || !workspaceStore.workspaceHandle) return;

  const projectId = projectStore.currentProjectId;
  const timelinePath = params.timelinePath;
  const timelineDoc = cloneValue(params.timelineDoc);

  // We still need to run buildVideoWorkerPayloadFromTracks asynchronously
  // outside the critical path, but before dispatching the thumbnail task
  void (async () => {
    try {
      const durationUs = selectTimelineDurationUs(timelineDoc);
      const previewTimeUs = Math.max(
        0,
        Math.min(Math.round(durationUs / 2), Math.max(0, durationUs - 1)),
      );

      if (isTauriRuntime()) {
        const scene = await buildNativeMonitorScene(timelineDoc);
        if (scene.layers.length === 0) return;
        const blob = await nativeRenderTimelineFrameWebp({
          scene,
          timeSec: previewTimeUs / 1_000_000,
          width: Math.max(160, Math.round(scene.width)),
          height: Math.max(90, Math.round(scene.height)),
          quality: 0.8,
        });
        await fileThumbnailGenerator.saveManualThumbnail({
          projectId,
          projectRelativePath: timelinePath,
          blob,
        });
        return;
      }

      const [{ buildVideoWorkerPayloadFromTracks }, { dispatchTimelineThumbnailGeneration }] =
        await Promise.all([
          import('~/composables/timeline/export'),
          import('~/timeline/services/timeline-thumbnail.service'),
        ]);

      const builtVideo = await buildVideoWorkerPayloadFromTracks({
        tracks: timelineDoc.tracks,
        projectStore,
        workspaceStore,
      });

      const rawClips = builtVideo.payload;
      if (rawClips.length === 0) return;

      dispatchTimelineThumbnailGeneration({
        projectId,
        timelinePath,
        timeUs: previewTimeUs,
        clipsPayload: rawClips,
        workspaceHandle: workspaceStore.workspaceHandle!,
        resolvedStorageTopology: workspaceStore.resolvedStorageTopology,
        getFileHandleByPath: async (path: string) => projectStore.getFileHandleByPath(path),
        getFileByPath: async (path: string) => projectStore.getFileByPath(path),
        notifyUi: false,
      });
    } catch (error) {
      log.error('Failed to prepare background timeline thumbnail generation:', error);
    }
  })();
}
