import { describe, expect, it } from 'vitest';
import { Texture } from 'pixi.js';

import { ClipMaskFilter } from '~/utils/video-editor/compositor/filters/ClipMaskFilter';

describe('ClipMaskFilter', () => {
  it('stores mask texture source and uniforms in Pixi v8 resource format', () => {
    const filter = new ClipMaskFilter({
      uMask: Texture.WHITE.source,
      uMode: 1,
      uInvert: true,
    });

    expect(filter.resources.uMaskTexture).toBe(Texture.WHITE.source);
    expect(filter.resources.clipMaskUniforms.uniforms.uMode).toBe(1);
    expect(filter.resources.clipMaskUniforms.uniforms.uInvert).toBe(1);
    expect(filter.uMode).toBe(1);
    expect(filter.uInvert).toBe(true);
  });

  it('updates mode and invert flags through accessors', () => {
    const filter = new ClipMaskFilter({
      uMask: Texture.WHITE.source,
      uMode: 0,
      uInvert: false,
    });

    filter.uMode = 1;
    filter.uInvert = true;

    expect(filter.resources.clipMaskUniforms.uniforms.uMode).toBe(1);
    expect(filter.resources.clipMaskUniforms.uniforms.uInvert).toBe(1);
  });
});
