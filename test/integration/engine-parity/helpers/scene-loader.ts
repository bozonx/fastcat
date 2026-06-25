import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DEFAULT_TOLERANCE } from './frame-hash';

/**
 * A scene fixture loaded from `shared/scenes/`.
 * The `scene` field matches the `MonitorScene` IPC contract (ts-rs generated),
 * so both the web and native engines can deserialize it.
 */
export interface SceneFixture {
  scene: Record<string, unknown>;
  sample_times_sec: number[];
  /**
   * Maximum Hamming distance allowed between engine hashes and the golden.
   * Scenes with text rendering use a higher tolerance due to font
   * rasterization divergence between web and native.
   */
  tolerance: number;
}

const SCENES_DIR = resolve(process.cwd(), 'shared/scenes');

/** Load a single scene fixture by filename (e.g. `solid-background.json`). */
export function loadScene(filename: string): SceneFixture {
  const raw = readFileSync(resolve(SCENES_DIR, filename), 'utf8');
  return JSON.parse(raw) as SceneFixture;
}

/** List all scene fixture filenames in `shared/scenes/`. */
export function listSceneFiles(): string[] {
  return readdirSync(SCENES_DIR).filter((f) => f.endsWith('.json'));
}

/**
 * Load all scene fixtures from `shared/scenes/`, sorted by filename.
 * Each scene's `tolerance` defaults to `DEFAULT_TOLERANCE` if not set in JSON.
 */
export function loadAllScenes(): Array<{ filename: string; fixture: SceneFixture }> {
  return listSceneFiles()
    .sort()
    .map((filename) => {
      const fixture = loadScene(filename);
      if (fixture.tolerance === undefined) {
        fixture.tolerance = DEFAULT_TOLERANCE;
      }
      return { filename, fixture };
    });
}

/**
 * Resolve a relative media path from a scene layer to an absolute filesystem
 * path under `test/fixtures/media/`. Used by the test harness to load fixture
 * bytes before injecting them into OPFS (web) or passing to ffmpeg (native).
 */
export function resolveMediaPath(relativePath: string): string {
  return resolve(process.cwd(), 'test/fixtures/media', relativePath);
}

/**
 * Collect all unique media paths referenced by a scene's layers.
 * Returns relative paths (as stored in the scene); callers resolve them.
 */
export function collectSceneMediaPaths(scene: Record<string, unknown>): string[] {
  const layers = (scene.layers as Array<Record<string, unknown>> | undefined) ?? [];
  const paths = layers
    .map((l) => l.path as string | undefined)
    .filter((p): p is string => Boolean(p && p.length > 0));
  return [...new Set(paths)];
}
