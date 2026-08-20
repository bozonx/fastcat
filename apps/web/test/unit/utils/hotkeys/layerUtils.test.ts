/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { isLayerActive, isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';

describe('isLayerActive', () => {
  it('detects shift layer', () => {
    expect(isLayerActive({ shiftKey: true } as any, 'Shift')).toBe(true);
    expect(isLayerActive({ shiftKey: false } as any, 'Shift')).toBe(false);
  });

  it('detects control layer', () => {
    expect(isLayerActive({ ctrlKey: true } as any, 'Control')).toBe(true);
    expect(isLayerActive({ ctrlKey: false } as any, 'Control')).toBe(false);
  });

  it('detects alt layer', () => {
    expect(isLayerActive({ altKey: true } as any, 'Alt')).toBe(true);
    expect(isLayerActive({ altKey: false } as any, 'Alt')).toBe(false);
  });

  it('detects meta layer', () => {
    expect(isLayerActive({ metaKey: true } as any, 'Meta')).toBe(true);
    expect(isLayerActive({ metaKey: false } as any, 'Meta')).toBe(false);
  });
});

describe('isLayer1Active', () => {
  it('uses settings layer1', () => {
    const settings = { hotkeys: { layer1: 'Alt' } } as any;
    expect(isLayer1Active({ altKey: true } as any, settings)).toBe(true);
    expect(isLayer1Active({ altKey: false } as any, settings)).toBe(false);
  });

  it('defaults to Shift', () => {
    const settings = { hotkeys: {} } as any;
    expect(isLayer1Active({ shiftKey: true } as any, settings)).toBe(true);
  });
});

describe('isLayer2Active', () => {
  it('uses settings layer2', () => {
    const settings = { hotkeys: { layer2: 'Alt' } } as any;
    expect(isLayer2Active({ altKey: true } as any, settings)).toBe(true);
    expect(isLayer2Active({ altKey: false } as any, settings)).toBe(false);
  });

  it('defaults to Control', () => {
    const settings = { hotkeys: {} } as any;
    expect(isLayer2Active({ ctrlKey: true } as any, settings)).toBe(true);
  });
});
