/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadAllScenes,
  listSceneFiles,
  collectSceneMediaPaths,
  resolveMediaPath,
} from '../../integration/engine-parity/helpers/scene-loader';

describe('scene coverage integration', () => {
  const scenes = loadAllScenes();

  describe('scene discovery', () => {
    it('discovers at least 8 scene fixtures', () => {
      expect(scenes.length).toBeGreaterThanOrEqual(8);
    });

    it('all scene files are valid JSON with required fields', () => {
      for (const { filename, fixture } of scenes) {
        expect(fixture.scene, `${filename}: missing scene`).toBeDefined();
        expect(fixture.sample_times_sec, `${filename}: missing sample_times_sec`).toBeInstanceOf(
          Array,
        );
        expect(
          fixture.sample_times_sec.length,
          `${filename}: empty sample_times_sec`,
        ).toBeGreaterThan(0);
        expect(fixture.tolerance, `${filename}: missing tolerance`).toBeGreaterThan(0);
      }
    });

    it('scenes are sorted by filename', () => {
      const filenames = scenes.map((s) => s.filename);
      const sorted = [...filenames].sort();
      expect(filenames).toEqual(sorted);
    });

    it('every scene file in the directory is loaded', () => {
      const files = listSceneFiles();
      expect(files.length).toBe(scenes.length);
    });
  });

  describe('scene structure', () => {
    it('every scene has a layers array', () => {
      for (const { filename, fixture } of scenes) {
        const scene = fixture.scene as Record<string, unknown>;
        const layers = scene.layers;
        expect(Array.isArray(layers), `${filename}: scene.layers is not an array`).toBe(true);
        expect((layers as unknown[]).length, `${filename}: scene has no layers`).toBeGreaterThan(0);
      }
    });

    it('every scene has width and height', () => {
      for (const { filename, fixture } of scenes) {
        const scene = fixture.scene as Record<string, unknown>;
        expect(scene.width, `${filename}: missing width`).toBeGreaterThan(0);
        expect(scene.height, `${filename}: missing height`).toBeGreaterThan(0);
      }
    });

    it('every layer has required fields (id, kind, z, timeline_start_sec, timeline_end_sec)', () => {
      for (const { filename, fixture } of scenes) {
        const scene = fixture.scene as { layers: Array<Record<string, unknown>> };
        for (const layer of scene.layers) {
          expect(layer.id, `${filename}: layer missing id`).toBeDefined();
          expect(layer.kind, `${filename}: layer missing kind`).toBeDefined();
          expect(layer.z, `${filename}: layer missing z`).toBeDefined();
          expect(
            layer.timeline_start_sec,
            `${filename}: layer missing timeline_start_sec`,
          ).toBeDefined();
          expect(
            layer.timeline_end_sec,
            `${filename}: layer missing timeline_end_sec`,
          ).toBeDefined();
        }
      }
    });

    it('layer z-indexes are unique within a scene', () => {
      for (const { filename, fixture } of scenes) {
        const scene = fixture.scene as { layers: Array<Record<string, unknown>> };
        const zValues = scene.layers.map((l) => l.z);
        const unique = new Set(zValues);
        expect(
          unique.size,
          `${filename}: duplicate z-indexes in layers: ${zValues.join(', ')}`,
        ).toBe(zValues.length);
      }
    });
  });

  describe('layer kind coverage', () => {
    it('covers background, image, video, text, and shape layer kinds', () => {
      const kinds = new Set<string>();
      for (const { fixture } of scenes) {
        const scene = fixture.scene as { layers: Array<Record<string, unknown>> };
        for (const layer of scene.layers) {
          kinds.add(layer.kind as string);
        }
      }

      expect(kinds.has('background')).toBe(true);
      expect(kinds.has('image')).toBe(true);
      expect(kinds.has('video')).toBe(true);
      expect(kinds.has('text')).toBe(true);
      expect(kinds.has('shape')).toBe(true);
    });

    it('shape layers have shape_type, fill_color, and stroke_width', () => {
      for (const { filename, fixture } of scenes) {
        const scene = fixture.scene as { layers: Array<Record<string, unknown>> };
        for (const layer of scene.layers) {
          if (layer.kind !== 'shape') continue;
          expect(layer.shape_type, `${filename}: shape layer missing shape_type`).toBeDefined();
          expect(layer.fill_color, `${filename}: shape layer missing fill_color`).toBeDefined();
          expect(layer.stroke_width, `${filename}: shape layer missing stroke_width`).toBeDefined();
        }
      }
    });

    it('text layers have text and style', () => {
      for (const { filename, fixture } of scenes) {
        const scene = fixture.scene as { layers: Array<Record<string, unknown>> };
        for (const layer of scene.layers) {
          if (layer.kind !== 'text') continue;
          expect(layer.text, `${filename}: text layer missing text`).toBeDefined();
          expect(layer.style, `${filename}: text layer missing style`).toBeDefined();
        }
      }
    });

    it('transform layers have valid transform structure', () => {
      for (const { filename, fixture } of scenes) {
        const scene = fixture.scene as { layers: Array<Record<string, unknown>> };
        for (const layer of scene.layers) {
          const transform = layer.transform as Record<string, unknown> | undefined;
          if (!transform) continue;

          expect(transform.x, `${filename}: transform missing x`).toBeDefined();
          expect(transform.y, `${filename}: transform missing y`).toBeDefined();
          expect(transform.scale_x, `${filename}: transform missing scale_x`).toBeDefined();
          expect(transform.scale_y, `${filename}: transform missing scale_y`).toBeDefined();
          expect(
            transform.rotation_deg,
            `${filename}: transform missing rotation_deg`,
          ).toBeDefined();
        }
      }
    });
  });

  describe('sample times', () => {
    it('all sample times are within [0, timeline_end_sec]', () => {
      for (const { filename, fixture } of scenes) {
        const scene = fixture.scene as { layers: Array<Record<string, unknown>> };
        const maxEnd = Math.max(...scene.layers.map((l) => l.timeline_end_sec as number));

        for (const timeSec of fixture.sample_times_sec) {
          expect(
            timeSec >= 0 && timeSec <= maxEnd,
            `${filename}: sample time ${timeSec} outside [0, ${maxEnd}]`,
          ).toBe(true);
        }
      }
    });

    it('multi-time-samples scene has multiple sample times', () => {
      const multiTime = scenes.find((s) => s.filename === 'multi-time-samples.json');
      expect(multiTime).toBeDefined();
      expect(multiTime!.fixture.sample_times_sec.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('media fixtures', () => {
    it('all referenced media paths resolve to existing files', () => {
      for (const { filename, fixture } of scenes) {
        const mediaPaths = collectSceneMediaPaths(fixture.scene);

        for (const relPath of mediaPaths) {
          const absPath = resolveMediaPath(relPath);
          expect(
            existsSync(absPath),
            `${filename}: media fixture "${relPath}" not found at ${absPath}`,
          ).toBe(true);
        }
      }
    });

    it('video-clip and multi-time-samples scenes reference the same video fixture', () => {
      const videoClip = scenes.find((s) => s.filename === 'video-clip.json');
      const multiTime = scenes.find((s) => s.filename === 'multi-time-samples.json');

      if (videoClip && multiTime) {
        const videoPaths = collectSceneMediaPaths(videoClip.fixture.scene);
        const multiPaths = collectSceneMediaPaths(multiTime.fixture.scene);

        expect(videoPaths).toContain('video/video-h264-aac.mp4');
        expect(multiPaths).toContain('video/video-h264-aac.mp4');
      }
    });
  });
});
