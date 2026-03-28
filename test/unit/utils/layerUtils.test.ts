import { describe, expect, it } from 'vitest';
import { isLayerActive, isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';
import { DEFAULT_USER_SETTINGS, type FastCatUserSettings } from '~/utils/settings/defaults';

describe('layerUtils', () => {
  describe('isLayerActive', () => {
    it('handles base modifiers via event properties', () => {
      const e = { shiftKey: true, ctrlKey: false, altKey: false, metaKey: false } as MouseEvent;
      expect(isLayerActive(e, 'Shift')).toBe(true);
      expect(isLayerActive(e, 'Control')).toBe(false);
    });

    it('handles alternate modifiers via event properties', () => {
      const e = { shiftKey: false, ctrlKey: true, altKey: true, metaKey: false } as MouseEvent;
      expect(isLayerActive(e, 'Control')).toBe(true);
      expect(isLayerActive(e, 'Alt')).toBe(true);
    });
  });

  describe('isLayer1Active', () => {
    it('uses configured layer1 from settings', () => {
      const settings: FastCatUserSettings = {
        ...DEFAULT_USER_SETTINGS,
        hotkeys: { ...DEFAULT_USER_SETTINGS.hotkeys, layer1: 'Alt' },
      };
      const e = { altKey: true, shiftKey: false } as MouseEvent;
      expect(isLayer1Active(e, settings)).toBe(true);
    });

    it('fallbacks to Shift if layer1 is missing', () => {
      const settings: FastCatUserSettings = {
        ...DEFAULT_USER_SETTINGS,
        hotkeys: { ...DEFAULT_USER_SETTINGS.hotkeys, layer1: undefined as any },
      };
      const e = { shiftKey: true } as MouseEvent;
      expect(isLayer1Active(e, settings)).toBe(true);
    });
  });

  describe('isLayer2Active', () => {
    it('uses configured layer2 from settings', () => {
      const settings: FastCatUserSettings = {
        ...DEFAULT_USER_SETTINGS,
        hotkeys: { ...DEFAULT_USER_SETTINGS.hotkeys, layer2: 'Meta' },
      };
      const e = { metaKey: true, ctrlKey: false } as MouseEvent;
      expect(isLayer2Active(e, settings)).toBe(true);
    });
  });
});
