import type { Page } from '@playwright/test';

/**
 * Bridge for driving the web video engine from Playwright tests.
 *
 * Each function runs inside the page context via `page.evaluate`, so it has
 * access to `navigator.gpu`, OPFS, Web Workers, and all browser APIs.
 * The compositor is instantiated directly (not through the Vue app) so we
 * can control it precisely and extract raw RGBA for hashing.
 */

/** Result of a single frame render + hash computation. */
export interface WebFrameResult {
  hash: string;
  width: number;
  height: number;
  error?: string;
}

/** Scene JSON as parsed from shared/scenes/. */
export interface WebSceneData {
  scene: Record<string, unknown>;
  sample_times_sec: number[];
}

/**
 * Mapping from relative media paths (as used in scene layers) to OPFS paths
 * where the fixture bytes have been pre-loaded.
 */
export interface MediaPathMapping {
  [relativePath: string]: string;
}

/**
 * Render frames for a scene at the given sample times and return perceptual
 * hashes. Runs entirely inside the browser page context.
 */
export async function renderWebFrames(
  page: Page,
  sceneData: WebSceneData,
  mediaMapping: MediaPathMapping,
): Promise<WebFrameResult[]> {
  return await page.evaluate(
    async ({ sceneData, mediaMapping }) => {
      // Dynamic imports — these resolve inside the page's module graph.
      const { VideoCompositor } = await import('~/utils/video-editor/VideoCompositor');
      const { initEffects } = await import('~/effects');
      const { initTransitions } = await import('~/transitions');

      await initEffects();
      await initTransitions();

      const scene = sceneData.scene as {
        layers: Array<Record<string, unknown>>;
        width: number;
        height: number;
      };

      const width = scene.width ?? 320;
      const height = scene.height ?? 240;

      // Build WorkerVideoPayloadItem[] from the scene layers.
      // Each MonitorScene layer maps to a WorkerTimelineClip.
      const clips = scene.layers.map((layer) => {
        const kind = layer.kind as string;
        const clipType =
          kind === 'background'
            ? 'background'
            : kind === 'text'
              ? 'text'
              : kind === 'shape'
                ? 'shape'
                : kind === 'image' || kind === 'video'
                  ? 'media'
                  : 'media';

        const sourcePath = mediaMapping[layer.path as string] ?? '';
        const timelineStartSec = layer.timeline_start_sec as number;
        const timelineEndSec = layer.timeline_end_sec as number;
        const sourceStartSec = layer.source_start_sec as number;
        const sourceRangeDurationSec = layer.source_range_duration_sec as number;

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
          effects: (layer.effects as unknown[]) ?? [],
        };
      });

      const compositor = new VideoCompositor();
      await compositor.init(width, height, '#000', true);

      // Provide a minimal file resolver that reads from OPFS.
      const fileResolver = async (path: string): Promise<File | null> => {
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
      };

      const deps = {
        getFileByPath: fileResolver,
      } as unknown as Parameters<typeof compositor.loadTimeline>[1];

      await compositor.loadTimeline(clips, deps);

      const results: WebFrameResult[] = [];

      for (const timeSec of sceneData.sample_times_sec) {
        const timeUs = Math.round(timeSec * 1_000_000);
        const canvas = await compositor.renderFrame(timeUs);

        if (!canvas) {
          results.push({ hash: '', width, height, error: 'renderFrame returned null' });
          continue;
        }

        // Extract RGBA from the canvas.
        const ctx = (
          canvas as OffscreenCanvas | HTMLCanvasElement
        ).getContext('2d') as CanvasRenderingContext2D | null;
        if (!ctx) {
          results.push({ hash: '', width, height, error: 'no 2d context' });
          continue;
        }

        const imageData = ctx.getImageData(0, 0, width, height);
        const rgba = imageData.data;

        // Compute perceptual hash (8x8 average hash).
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

        results.push({
          hash: hash.toString(16).padStart(16, '0'),
          width,
          height,
        });
      }

      await compositor.destroy();
      return results;
    },
    { sceneData, mediaMapping } as { sceneData: WebSceneData; mediaMapping: MediaPathMapping },
  );
}
