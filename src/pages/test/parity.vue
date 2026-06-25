<script setup lang="ts">
import { VideoCompositor } from '~/utils/video-editor/VideoCompositor';
import type { WorkerVideoPayloadItem } from '~/types/worker-payload';
import type { MediaSourceLoaderDeps } from '~/utils/video-editor/compositor/RasterImageLoader';

definePageMeta({
  layout: 'embedded',
});

interface ParitySceneData {
  layers: Array<Record<string, unknown>>;
  width: number;
  height: number;
}

interface ParityRenderRequest {
  scene: ParitySceneData;
  sampleTimesSec: number[];
  mediaMapping: Record<string, string>;
}

interface ParityFrameResult {
  hash: string;
  width: number;
  height: number;
  error?: string;
}

async function readFileFromOpfs(path: string): Promise<File | null> {
  if (!path) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const parts = path.split('/').filter(Boolean);
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]!);
    }
    const handle = await dir.getFileHandle(parts[parts.length - 1]!);
    return await handle.getFile();
  } catch {
    return null;
  }
}

async function getFileHandleByPathFromOpfs(path: string): Promise<FileSystemFileHandle | null> {
  if (!path) return null;
  try {
    const root = await navigator.storage.getDirectory();
    const parts = path.split('/').filter(Boolean);
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]!);
    }
    return await dir.getFileHandle(parts[parts.length - 1]!);
  } catch {
    return null;
  }
}

function buildClipsFromScene(
  scene: ParitySceneData,
  mediaMapping: Record<string, string>,
): WorkerVideoPayloadItem[] {
  return scene.layers.map((layer) => {
    const kind = layer.kind as string;
    const clipType =
      kind === 'background'
        ? 'background'
        : kind === 'text'
          ? 'text'
          : kind === 'shape'
            ? 'shape'
            : kind === 'adjustment'
              ? 'adjustment'
              : 'media';

    const sourcePath = mediaMapping[layer.path as string] ?? '';
    const timelineStartSec = layer.timeline_start_sec as number;
    const timelineEndSec = layer.timeline_end_sec as number;
    const sourceStartSec = layer.source_start_sec as number;
    const sourceRangeDurationSec = layer.source_range_duration_sec as number;

    // Map scene-layer transform (snake_case) to worker payload transform (camelCase).
    // Scene JSON x/y are absolute scene-space pixel coordinates (anchor point position).
    // ClipTransform.position is an offset from the center-fitted position, so we
    // convert: offset = absolute - sceneCenter.
    const sceneWidth = scene.width as number;
    const sceneHeight = scene.height as number;
    const sceneTransform = layer.transform as Record<string, unknown> | undefined;
    const transform = sceneTransform
      ? {
          scale: {
            x: (sceneTransform.scale_x as number) ?? 1,
            y: (sceneTransform.scale_y as number) ?? 1,
          },
          rotationDeg: (sceneTransform.rotation_deg as number) ?? 0,
          position: {
            x: ((sceneTransform.x as number) ?? sceneWidth / 2) - sceneWidth / 2,
            y: ((sceneTransform.y as number) ?? sceneHeight / 2) - sceneHeight / 2,
          },
          anchor: {
            x: (sceneTransform.anchor_x as number) ?? 0.5,
            y: (sceneTransform.anchor_y as number) ?? 0.5,
          },
          crop: {
            top: (sceneTransform.crop_top as number) ?? 0,
            bottom: (sceneTransform.crop_bottom as number) ?? 0,
            left: (sceneTransform.crop_left as number) ?? 0,
            right: (sceneTransform.crop_right as number) ?? 0,
          },
        }
      : undefined;

    // Map scene-layer transitions (snake_case) to worker payload (camelCase).
    const sceneTransitionIn = layer.transition_in as Record<string, unknown> | undefined;
    const sceneTransitionOut = layer.transition_out as Record<string, unknown> | undefined;
    const transitionIn = sceneTransitionIn
      ? {
          type: sceneTransitionIn.type as string,
          durationUs: Math.round((sceneTransitionIn.duration_sec as number) * 1_000_000),
          mode: (sceneTransitionIn.mode as string) ?? 'transparent',
          curve: (sceneTransitionIn.curve as string) ?? 'linear',
          params: (sceneTransitionIn.params as Record<string, unknown>) ?? {},
        }
      : undefined;
    const transitionOut = sceneTransitionOut
      ? {
          type: sceneTransitionOut.type as string,
          durationUs: Math.round((sceneTransitionOut.duration_sec as number) * 1_000_000),
          mode: (sceneTransitionOut.mode as string) ?? 'transparent',
          curve: (sceneTransitionOut.curve as string) ?? 'linear',
          params: (sceneTransitionOut.params as Record<string, unknown>) ?? {},
        }
      : undefined;

    return {
      kind: 'clip' as const,
      clipType,
      id: layer.id as string,
      layer: layer.z as number,
      speed: (layer.speed as number) ?? 1,
      opacity: (layer.opacity as number) ?? 1,
      blendMode: (layer.blend_mode as string) ?? 'normal',
      backgroundColor: layer.background_color as string | undefined,
      text: layer.text as string | undefined,
      style: layer.style as Record<string, unknown> | undefined,
      shapeType: layer.shape_type as string | undefined,
      fillColor: layer.fill_color as string | undefined,
      strokeColor: layer.stroke_color as string | undefined,
      strokeWidth: layer.stroke_width as number | undefined,
      shapeConfig: layer.shape_config as Record<string, unknown> | undefined,
      transform,
      transitionIn,
      transitionOut,
      source: sourcePath ? { path: sourcePath } : undefined,
      timelineRange: {
        startUs: Math.round(timelineStartSec * 1_000_000),
        durationUs: Math.round((timelineEndSec - timelineStartSec) * 1_000_000),
      },
      sourceRange: {
        startUs: Math.round(sourceStartSec * 1_000_000),
        durationUs: Math.round(sourceRangeDurationSec * 1_000_000),
      },
      sourceDurationUs: layer.source_duration_sec
        ? Math.round((layer.source_duration_sec as number) * 1_000_000)
        : undefined,
      sourceOrientation: (layer.source_orientation as string) ?? undefined,
      effects: (layer.effects as unknown[]) ?? [],
    } as WorkerVideoPayloadItem;
  });
}

function computePerceptualHash(rgba: Uint8ClampedArray, width: number, height: number): string {
  const grid = new Float64Array(64);
  const counts = new Float64Array(64);
  const xStep = width / 8;
  const yStep = height / 8;

  for (let y = 0; y < height; y++) {
    const gy = Math.min(7, Math.floor(y / yStep));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(7, Math.floor(x / xStep));
      const i = (y * width + x) * 4;
      const luma = 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
      const idx = gy * 8 + gx;
      grid[idx]! += luma;
      counts[idx]! += 1;
    }
  }

  for (let i = 0; i < 64; i++) {
    grid[i] = counts[i]! > 0 ? grid[i]! / counts[i]! : 0;
  }

  let sum = 0;
  for (let i = 0; i < 64; i++) sum += grid[i]!;
  const mean = sum / 64;

  let hash = 0n;
  for (let i = 0; i < 64; i++) {
    if (grid[i]! > mean) {
      hash |= 1n << BigInt(63 - i);
    }
  }

  return hash.toString(16).padStart(16, '0');
}

async function renderFrames(req: ParityRenderRequest): Promise<ParityFrameResult[]> {
  const width = req.scene.width ?? 320;
  const height = req.scene.height ?? 240;

  const clips = buildClipsFromScene(req.scene, req.mediaMapping);

  const compositor = new VideoCompositor();
  await compositor.init(width, height, '#000', true);

  const deps: MediaSourceLoaderDeps = {
    getFileHandleByPath: async (path: string) => getFileHandleByPathFromOpfs(path),
    getFileByPath: async (path: string) => readFileFromOpfs(path),
  };

  await compositor.loadTimeline(clips, deps);

  const results: ParityFrameResult[] = [];

  for (const timeSec of req.sampleTimesSec) {
    const timeUs = Math.round(timeSec * 1_000_000);
    const canvas = await compositor.renderFrame(timeUs);

    if (!canvas) {
      results.push({ hash: '', width, height, error: 'renderFrame returned null' });
      continue;
    }

    // The compositor canvas has a WebGL/WebGPU context (PixiJS), not 2d.
    // Draw it onto a temporary 2d canvas to extract RGBA pixels.
    const tmp = document.createElement('canvas');
    tmp.width = width;
    tmp.height = height;
    const tmpCtx = tmp.getContext('2d');
    if (!tmpCtx) {
      results.push({ hash: '', width, height, error: 'no 2d context on tmp canvas' });
      continue;
    }

    tmpCtx.drawImage(canvas as OffscreenCanvas | HTMLCanvasElement, 0, 0);
    const imageData = tmpCtx.getImageData(0, 0, width, height);
    const hash = computePerceptualHash(imageData.data, width, height);

    results.push({ hash, width, height });
  }

  await compositor.destroy();
  return results;
}

onMounted(() => {
  (window as unknown as { __parityEngine: { renderFrames: typeof renderFrames } }).__parityEngine =
    {
      renderFrames,
    };
});
</script>

<template>
  <div class="flex h-screen items-center justify-center bg-neutral-900 text-neutral-100">
    <div class="text-center">
      <h1 class="text-xl font-bold">Parity Engine Test Page</h1>
      <p class="mt-2 text-sm text-neutral-400">window.__parityEngine is ready</p>
    </div>
  </div>
</template>
