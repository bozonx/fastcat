/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadAllScenes,
  listSceneFiles,
  collectSceneMediaPaths,
  resolveMediaPath,
} from '../../golden-helpers/scene-loader';

describe('scene coverage integration', () => {
  const scenes = loadAllScenes();

  describe('scene discovery', () => {
    it('discovers at least 13 scene fixtures', () => {
      expect(scenes.length).toBeGreaterThanOrEqual(13);
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

  describe('effects coverage', () => {
    it('at least one scene has non-empty effects on a non-background layer', () => {
      let found = false;
      for (const { fixture } of scenes) {
        const scene = fixture.scene as { layers: Array<Record<string, unknown>> };
        for (const layer of scene.layers) {
          const effects = layer.effects as unknown[] | undefined;
          if (effects && effects.length > 0 && layer.kind !== 'background') {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      expect(found, 'no scene with non-background effects found').toBe(true);
    });

    it('effect-blur scene has a gaussian-blur effect', () => {
      const scene = scenes.find((s) => s.filename === 'effect-blur.json');
      expect(scene).toBeDefined();
      const layers = scene!.fixture.scene.layers as Array<Record<string, unknown>>;
      const img = layers.find((l) => l.kind === 'image');
      const effects = img!.effects as Array<Record<string, unknown>>;
      expect(effects).toHaveLength(1);
      expect(effects[0].type).toBe('gaussian-blur');
      expect(effects[0].radius).toBe(12);
    });

    it('effect-blur-mix scene has a gaussian-blur with mix < 1.0', () => {
      const scene = scenes.find((s) => s.filename === 'effect-blur-mix.json');
      expect(scene).toBeDefined();
      const layers = scene!.fixture.scene.layers as Array<Record<string, unknown>>;
      const img = layers.find((l) => l.kind === 'image');
      const effects = img!.effects as Array<Record<string, unknown>>;
      expect(effects).toHaveLength(1);
      expect(effects[0].type).toBe('gaussian-blur');
      expect(effects[0].mix).toBeLessThan(1.0);
    });

    it('effect-chain-blur-brightness has blur before brightness', () => {
      const scene = scenes.find((s) => s.filename === 'effect-chain-blur-brightness.json');
      expect(scene).toBeDefined();
      const layers = scene!.fixture.scene.layers as Array<Record<string, unknown>>;
      const img = layers.find((l) => l.kind === 'image');
      const effects = img!.effects as Array<Record<string, unknown>>;
      expect(effects).toHaveLength(2);
      expect(effects[0].type).toBe('gaussian-blur');
      expect(effects[1].type).toBe('brightness');
    });

    it('effect-chain-brightness-blur has brightness before blur', () => {
      const scene = scenes.find((s) => s.filename === 'effect-chain-brightness-blur.json');
      expect(scene).toBeDefined();
      const layers = scene!.fixture.scene.layers as Array<Record<string, unknown>>;
      const img = layers.find((l) => l.kind === 'image');
      const effects = img!.effects as Array<Record<string, unknown>>;
      expect(effects).toHaveLength(2);
      expect(effects[0].type).toBe('brightness');
      expect(effects[1].type).toBe('gaussian-blur');
    });

    it('effect-color-adjustment scene has brightness, contrast, and saturation effects', () => {
      const scene = scenes.find((s) => s.filename === 'effect-color-adjustment.json');
      expect(scene).toBeDefined();
      const layers = scene!.fixture.scene.layers as Array<Record<string, unknown>>;
      const img = layers.find((l) => l.kind === 'image');
      const effects = img!.effects as Array<Record<string, unknown>>;
      const types = effects.map((e) => e.type);
      expect(types).toContain('brightness');
      expect(types).toContain('contrast');
      expect(types).toContain('saturation');
    });

    it('every effect has a type field', () => {
      for (const { filename, fixture } of scenes) {
        const scene = fixture.scene as { layers: Array<Record<string, unknown>> };
        for (const layer of scene.layers) {
          const effects = layer.effects as Array<Record<string, unknown>> | undefined;
          if (!effects) continue;
          for (const effect of effects) {
            expect(effect.type, `${filename}: effect missing type`).toBeDefined();
          }
        }
      }
    });

    it('effect-chroma-key scene has a chroma-key effect', () => {
      const scene = scenes.find((s) => s.filename === 'effect-chroma-key.json');
      expect(scene).toBeDefined();
      const layers = scene!.fixture.scene.layers as Array<Record<string, unknown>>;
      const img = layers.find((l) => l.kind === 'image');
      const effects = img!.effects as Array<Record<string, unknown>>;
      expect(effects).toHaveLength(1);
      expect(effects[0].type).toBe('chroma-key');
      expect(effects[0].threshold).toBe(0.2);
    });

    it('effect-color-tone scene has a color-tone effect with all parameters', () => {
      const scene = scenes.find((s) => s.filename === 'effect-color-tone.json');
      expect(scene).toBeDefined();
      const layers = scene!.fixture.scene.layers as Array<Record<string, unknown>>;
      const img = layers.find((l) => l.kind === 'image');
      const effects = img!.effects as Array<Record<string, unknown>>;
      expect(effects).toHaveLength(1);
      expect(effects[0].type).toBe('color-tone');
      expect(effects[0].color_rgba).toEqual([47, 128, 255, 255]);
      expect(effects[0].amount).toBe(0.5);
      expect(effects[0].blend_mode).toBe('soft-light');
      expect(effects[0].preserve_luminance).toBe(true);
      expect(effects[0].range).toBe('all');
    });
  });

  describe('transitions coverage', () => {
    it('transition-dissolve scene has transition_in and transition_out', () => {
      const scene = scenes.find((s) => s.filename === 'transition-dissolve.json');
      expect(scene).toBeDefined();
      const layers = scene!.fixture.scene.layers as Array<Record<string, unknown>>;
      const clipA = layers.find((l) => l.id === 'clip-a');
      const clipB = layers.find((l) => l.id === 'clip-b');
      expect(clipA!.transition_out).toBeDefined();
      expect(clipB!.transition_in).toBeDefined();
      expect((clipA!.transition_out as Record<string, unknown>).type).toBe('dissolve');
      expect((clipB!.transition_in as Record<string, unknown>).type).toBe('dissolve');
    });

    it('every transition has type and duration_sec', () => {
      for (const { filename, fixture } of scenes) {
        const scene = fixture.scene as { layers: Array<Record<string, unknown>> };
        for (const layer of scene.layers) {
          const tin = layer.transition_in as Record<string, unknown> | undefined;
          const tout = layer.transition_out as Record<string, unknown> | undefined;
          if (tin) {
            expect(tin.type, `${filename}: transition_in missing type`).toBeDefined();
            expect(
              tin.duration_sec,
              `${filename}: transition_in missing duration_sec`,
            ).toBeDefined();
          }
          if (tout) {
            expect(tout.type, `${filename}: transition_out missing type`).toBeDefined();
            expect(
              tout.duration_sec,
              `${filename}: transition_out missing duration_sec`,
            ).toBeDefined();
          }
        }
      }
    });
  });

  describe('speed coverage', () => {
    it('speed-change scene has speed != 1.0', () => {
      const scene = scenes.find((s) => s.filename === 'speed-change.json');
      expect(scene).toBeDefined();
      const layers = scene!.fixture.scene.layers as Array<Record<string, unknown>>;
      const video = layers.find((l) => l.kind === 'video');
      expect(video!.speed).toBe(2.0);
    });

    it('speed-change scene timeline is half the source duration', () => {
      const scene = scenes.find((s) => s.filename === 'speed-change.json');
      const layers = scene!.fixture.scene.layers as Array<Record<string, unknown>>;
      const video = layers.find((l) => l.kind === 'video')!;
      const timelineDuration =
        (video.timeline_end_sec as number) - (video.timeline_start_sec as number);
      const sourceDuration = video.source_range_duration_sec as number;
      expect(timelineDuration).toBeCloseTo(sourceDuration / 2, 5);
    });
  });

  describe('crop coverage', () => {
    it('crop-clip scene has non-zero crop values', () => {
      const scene = scenes.find((s) => s.filename === 'crop-clip.json');
      expect(scene).toBeDefined();
      const layers = scene!.fixture.scene.layers as Array<Record<string, unknown>>;
      const img = layers.find((l) => l.kind === 'image');
      const transform = img!.transform as Record<string, unknown>;
      expect(transform.crop_top).toBe(20);
      expect(transform.crop_bottom).toBe(20);
      expect(transform.crop_left).toBe(20);
      expect(transform.crop_right).toBe(20);
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

  describe('blend mode coverage', () => {
    it('covers every supported blend mode', () => {
      const blendModes = [
        'normal',
        'add',
        'multiply',
        'screen',
        'overlay',
        'darken',
        'lighten',
        'color-dodge',
        'color-burn',
        'hard-light',
        'soft-light',
        'difference',
        'exclusion',
        'hue',
        'saturation',
        'color',
        'luminosity',
      ];
      const used = new Set<string>();
      for (const { fixture } of scenes) {
        for (const layer of fixture.scene.layers as Array<Record<string, unknown>>) {
          used.add(layer.blend_mode as string);
        }
      }
      for (const mode of blendModes) {
        expect(used.has(mode), `missing blend mode "${mode}"`).toBe(true);
      }
    });
  });

  describe('shape type coverage', () => {
    it('covers every supported shape type', () => {
      const shapeTypes = ['square', 'circle', 'triangle', 'star', 'cloud', 'speech_bubble', 'bang'];
      const used = new Set<string>();
      for (const { fixture } of scenes) {
        for (const layer of fixture.scene.layers as Array<Record<string, unknown>>) {
          if (layer.kind === 'shape') {
            used.add(layer.shape_type as string);
          }
        }
      }
      for (const type of shapeTypes) {
        expect(used.has(type), `missing shape type "${type}"`).toBe(true);
      }
    });
  });

  describe('extra effects coverage', () => {
    it('effects-extra scene covers additional non-text video effects', () => {
      const scene = scenes.find((s) => s.filename === 'effects-extra.json');
      expect(scene).toBeDefined();
      const types = new Set<string>();
      for (const layer of scene!.fixture.scene.layers as Array<Record<string, unknown>>) {
        const effects = layer.effects as Array<Record<string, unknown>> | undefined;
        effects?.forEach((e) => types.add(e.type as string));
      }
      const expected = [
        'gaussian-blur',
        'bloom',
        'sharpen',
        'pixelate',
        'vignette',
        'chromatic-aberration',
        'hue',
        'levels',
        'noise',
        'color-tone',
      ];
      for (const t of expected) {
        expect(types.has(t), `missing effect type "${t}"`).toBe(true);
      }
    });
  });

  describe('transition type coverage', () => {
    it('covers all production transitions (dissolve, wipe, slide, fade-to-black, clock, barn-door, circle, rectangle)', () => {
      const used = new Set<string>();
      for (const { fixture } of scenes) {
        for (const layer of fixture.scene.layers as Array<Record<string, unknown>>) {
          const tin = layer.transition_in as Record<string, unknown> | undefined;
          const tout = layer.transition_out as Record<string, unknown> | undefined;
          if (tin) used.add(tin.type as string);
          if (tout) used.add(tout.type as string);
        }
      }
      const expectedProductionTransitions = [
        'dissolve',
        'wipe',
        'slide',
        'fade-to-black',
        'clock',
        'barn-door',
        'circle',
        'rectangle',
      ];
      for (const transitionType of expectedProductionTransitions) {
        expect(
          used.has(transitionType),
          `Production transition "${transitionType}" is missing golden scene coverage`,
        ).toBe(true);
      }
    });
  });

  describe('adjustment layer coverage', () => {
    it('covers adjustment layers', () => {
      const hasAdjustment = scenes.some(({ fixture }) =>
        (fixture.scene.layers as Array<Record<string, unknown>>).some(
          (l) => l.kind === 'adjustment',
        ),
      );
      expect(hasAdjustment).toBe(true);
    });
  });

  describe('source orientation coverage', () => {
    it('covers explicit source orientation', () => {
      const hasOrientation = scenes.some(({ fixture }) =>
        (fixture.scene.layers as Array<Record<string, unknown>>).some(
          (l) => typeof l.source_orientation === 'string',
        ),
      );
      expect(hasOrientation).toBe(true);
    });
  });

  describe('transform flip coverage', () => {
    it('transform-flip scene uses flip_horizontal for horizontal flip', () => {
      const scene = scenes.find((s) => s.filename === 'transform-flip.json');
      expect(scene).toBeDefined();
      const img = (scene!.fixture.scene.layers as Array<Record<string, unknown>>).find(
        (l) => l.kind === 'image',
      );
      const transform = img!.transform as Record<string, unknown>;
      expect(transform.flip_horizontal).toBe(true);
    });
  });
});
