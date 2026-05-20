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
        colorBlendMode: 'normal' as const,
        backgroundEnabled: true,
        backgroundColor: '#000000',
        backgroundAlpha: 1,
        backgroundRadius: 0,
        backgroundBlendMode: 'normal' as const,
        borderEnabled: false,
        borderColor: '#ffffff',
        borderAlpha: 1,
        borderWidth: 0,
      };
      expect(areTextClipStylesEqual(style, { ...style })).toBe(true);
    });

    it('detects colorBlendMode change', () => {
      const a = { colorBlendMode: 'normal' as const };
      const b = { colorBlendMode: 'multiply' as const };
      expect(areTextClipStylesEqual(a, b)).toBe(false);
    });

    it('detects backgroundBlendMode change', () => {
      const a = { backgroundBlendMode: 'normal' as const };
      const b = { backgroundBlendMode: 'add' as const };
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
