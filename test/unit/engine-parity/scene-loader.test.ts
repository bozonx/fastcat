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
    expect(scenes.length).toBeGreaterThanOrEqual(13);

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

  it('loads shape-layer scene with circle shape', () => {
    const scene = loadScene('shape-layer.json');
    expect(scene.tolerance).toBe(12);
    const layers = scene.scene.layers as Array<Record<string, unknown>>;
    const shape = layers.find((l) => l.kind === 'shape');
    expect(shape).toBeDefined();
    expect(shape!.shape_type).toBe('circle');
    expect(shape!.fill_color).toBe('#ff6600');
    expect(shape!.stroke_width).toBe(2);
  });

  it('loads transform-clip scene with transform', () => {
    const scene = loadScene('transform-clip.json');
    expect(scene.tolerance).toBe(12);
    const layers = scene.scene.layers as Array<Record<string, unknown>>;
    const img = layers.find((l) => l.kind === 'image');
    expect(img).toBeDefined();
    const transform = img!.transform as Record<string, unknown>;
    expect(transform).toBeDefined();
    expect(transform.scale_x).toBe(0.5);
    expect(transform.rotation_deg).toBe(15);
  });

  it('loads multi-time-samples scene with 5 sample times', () => {
    const scene = loadScene('multi-time-samples.json');
    expect(scene.tolerance).toBe(10);
    expect(scene.sample_times_sec).toEqual([0.0, 0.25, 0.5, 0.75, 1.0]);
  });

  it('collects media paths from multi-time-samples scene', () => {
    const scene = loadScene('multi-time-samples.json');
    const paths = collectSceneMediaPaths(scene.scene);
    expect(paths).toContain('video/video-h264-aac.mp4');
    expect(paths).toHaveLength(1);
  });
});
