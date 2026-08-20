/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { areTextClipStylesEqual } from '~/utils/video-editor/compositor/types';
import { mapBlendModeToComposite } from '~/utils/video-editor/text-layout';

describe('compositor/types', () => {
  describe('areTextClipStylesEqual', () => {
    it('returns true for identical styles', () => {
      const style = {
        color: '#ffffff',
        colorAlpha: 1,
        backgroundEnabled: true,
        backgroundColor: '#000000',
        backgroundAlpha: 1,
        backgroundRadius: 0,
        borderEnabled: false,
        borderColor: '#ffffff',
        borderAlpha: 1,
        borderWidth: 0,
      };
      expect(areTextClipStylesEqual(style, { ...style })).toBe(true);
    });

    it('detects textShadowSpread change', () => {
      const a = { textShadowSpread: 0 };
      const b = { textShadowSpread: 4 };
      expect(areTextClipStylesEqual(a, b)).toBe(false);
    });

    it('detects backgroundShadowSpread change', () => {
      const a = { backgroundShadowSpread: 0 };
      const b = { backgroundShadowSpread: 6 };
      expect(areTextClipStylesEqual(a, b)).toBe(false);
    });

    it('detects border property changes', () => {
      const base = {
        borderEnabled: false,
        borderColor: '#ffffff',
        borderAlpha: 1,
        borderWidth: 0,
      };
      expect(areTextClipStylesEqual(base, { ...base, borderEnabled: true })).toBe(false);
      expect(areTextClipStylesEqual(base, { ...base, borderColor: '#000000' })).toBe(false);
      expect(areTextClipStylesEqual(base, { ...base, borderAlpha: 0.5 })).toBe(false);
      expect(areTextClipStylesEqual(base, { ...base, borderWidth: 2 })).toBe(false);
    });
  });
});

describe('text-layout mapBlendModeToComposite', () => {
  it('maps timeline blend modes to canvas composite operations', () => {
    expect(mapBlendModeToComposite('normal')).toBe('source-over');
    expect(mapBlendModeToComposite('add')).toBe('lighter');
    expect(mapBlendModeToComposite('multiply')).toBe('multiply');
    expect(mapBlendModeToComposite('screen')).toBe('screen');
    expect(mapBlendModeToComposite('darken')).toBe('darken');
    expect(mapBlendModeToComposite('lighten')).toBe('lighten');
    expect(mapBlendModeToComposite('unknown')).toBe('source-over');
    expect(mapBlendModeToComposite(undefined)).toBe('source-over');
  });
});
