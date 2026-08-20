/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import barnDoorWgsl from '~shared/transitions/barn_door.wgsl?raw';
import blindsWgsl from '~shared/transitions/blinds.wgsl?raw';
import bloomWgsl from '~shared/transitions/bloom.wgsl?raw';
import cardSwapWgsl from '~shared/transitions/card_swap.wgsl?raw';
import clockWgsl from '~shared/transitions/clock.wgsl?raw';
import cubeWgsl from '~shared/transitions/cube.wgsl?raw';
import ellipseWgsl from '~shared/transitions/ellipse.wgsl?raw';
import fallingCardWgsl from '~shared/transitions/falling_card.wgsl?raw';
import motionBlurWgsl from '~shared/transitions/motion_blur.wgsl?raw';
import rectangleWgsl from '~shared/transitions/rectangle.wgsl?raw';
import zoomWgsl from '~shared/transitions/zoom.wgsl?raw';
import { transitionManifests } from '~/transitions/manifests';

const sharedShaderByTransition = new Map<string, string>([
  ['barn-door', barnDoorWgsl],
  ['blinds', blindsWgsl],
  ['bloom', bloomWgsl],
  ['card-swap', cardSwapWgsl],
  ['circle', ellipseWgsl],
  ['clock', clockWgsl],
  ['cube', cubeWgsl],
  ['falling-card', fallingCardWgsl],
  ['motion-blur', motionBlurWgsl],
  ['rectangle', rectangleWgsl],
  ['zoom', zoomWgsl],
]);

describe('shared transition WGSL sources', () => {
  it('uses the shared shader as the Tauri custom-wgsl payload', () => {
    for (const [transitionType, source] of sharedShaderByTransition) {
      const manifest = transitionManifests.find((candidate) => candidate.type === transitionType);
      const spec = manifest?.toTransitionSpec?.(manifest.defaultParams, 0.5);

      expect(spec, transitionType).toMatchObject({
        type: 'custom-wgsl',
        source,
      });
    }
  });

  it('keeps the native transition uniform ABI in every extracted shader', () => {
    for (const [transitionType, source] of sharedShaderByTransition) {
      expect(source, transitionType).toContain('struct TransitionUniform');
      expect(source, transitionType).toContain('speed: f32');
      expect(source, transitionType).toContain('p8: f32, p9: f32, p10: f32, p11: f32');
      expect(source, transitionType).toContain('@group(0) @binding(3) var<uniform> uni');
      expect(source, transitionType).toContain('@compute @workgroup_size(8, 8, 1)');
    }
  });
});
