/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  loadScene,
  listSceneFiles,
  loadAllScenes,
  collectSceneMediaPaths,
  resolveMediaPath,
} from '../../integration/engine-parity/helpers/scene-loader';

describe('scene-loader', () => {
  it('loads a shared scene fixture', () => {
    const scene = loadScene('solid-background.json');
    expect(scene).toHaveProperty('scene');
    expect(scene).toHaveProperty('sample_times_sec');
    expect(scene.sample_times_sec).toContain(0.5);
    expect(scene.tolerance).toBe(10);
  });

  it('loads text-layer scene with wider tolerance', () => {
    const scene = loadScene('text-layer.json');
    expect(scene.tolerance).toBe(18);
  });

  it('lists all scene fixture files', () => {
    const files = listSceneFiles();
    expect(files).toContain('solid-background.json');
    expect(files).toContain('text-layer.json');
    expect(files.every((f) => f.endsWith('.json'))).toBe(true);
  });

  it('collects unique media paths from scene layers', () => {
    const scene = loadScene('image-overlay.json');
    const paths = collectSceneMediaPaths(scene.scene);
    expect(paths).toContain('image/image.jpg');
    expect(paths).toHaveLength(1);
  });

  it('returns an empty array when no media paths are present', () => {
    const scene = loadScene('solid-background.json');
    const paths = collectSceneMediaPaths(scene.scene);
    expect(paths).toEqual([]);
  });

  it('resolves media paths relative to the project root', () => {
    const path = resolveMediaPath('image/image.jpg');
    expect(path).toMatch(/test\/fixtures\/media\/image\/image\.jpg$/);
  });

  it('loadAllScenes returns all scenes sorted by filename with tolerance', () => {
    const scenes = loadAllScenes();
    expect(scenes.length).toBeGreaterThanOrEqual(5);

    // Verify sorted by filename.
    const filenames = scenes.map((s) => s.filename);
    const sorted = [...filenames].sort();
    expect(filenames).toEqual(sorted);

    // Each scene must have a tolerance.
    for (const { filename, fixture } of scenes) {
      expect(fixture.tolerance).toBeGreaterThan(0);
      expect(fixture.scene).toBeDefined();
      expect(fixture.sample_times_sec).toBeInstanceOf(Array);
      expect(filename).toMatch(/\.json$/);
    }
  });
});
