import { describe, it, expect } from 'vitest';
import {
  parseHotkeyCombo,
  stringifyHotkey,
  normalizeHotkeyCombo,
  hotkeyFromKeyboardEvent,
} from '~/utils/hotkeys/hotkeyUtils';

describe('hotkeyUtils', () => {
  describe('parseHotkeyCombo', () => {
    it('parses basic modifiers and key', () => {
      expect(parseHotkeyCombo('Ctrl+Shift+S')).toEqual({
        ctrl: true,
        meta: false,
        alt: false,
        shift: true,
        key: 'S',
      });
    });

    it('normalizes key casing', () => {
      expect(parseHotkeyCombo('ctrl+s')).toEqual({
        ctrl: true,
        meta: false,
        alt: false,
        shift: false,
        key: 'S',
      });

      expect(parseHotkeyCombo('alt+enter')).toEqual({
        ctrl: false,
        meta: false,
        alt: true,
        shift: false,
        key: 'Enter',
      });
    });

    it('returns null for empty or invalid input', () => {
      expect(parseHotkeyCombo('')).toBeNull();
      // @ts-expect-error test invalid input
      expect(parseHotkeyCombo(null)).toBeNull();
      expect(parseHotkeyCombo('Ctrl+')).toBeNull(); // Missing key
    });
  });

  describe('stringifyHotkey', () => {
    it('formats modifiers in specific order', () => {
      const parsed = {
        ctrl: true,
        meta: true,
        alt: true,
        shift: true,
        key: 'A',
      };
      expect(stringifyHotkey(parsed)).toBe('Ctrl+Meta+Alt+Shift+A');
    });

    it('ignores empty keys gracefully', () => {
      const parsed = {
        ctrl: true,
        meta: false,
        alt: false,
        shift: false,
        key: '',
      };
      expect(stringifyHotkey(parsed)).toBe('Ctrl');
    });
  });

  describe('normalizeHotkeyCombo', () => {
    it('fixes inconsistent casing and spacing', () => {
      expect(normalizeHotkeyCombo('  ctrl  +   shift + a  ')).toBe('Ctrl+Shift+A');
      expect(normalizeHotkeyCombo('ALT+space')).toBe('Alt+Space');
      expect(normalizeHotkeyCombo('meta+esc')).toBe('Meta+Escape');
    });

    it('returns null if cannot parse', () => {
      expect(normalizeHotkeyCombo('+')).toBeNull();
    });
  });

  describe('hotkeyFromKeyboardEvent', () => {
    it('generates hotkey combo from event', () => {
      const event = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        shiftKey: true,
      });

      expect(hotkeyFromKeyboardEvent(event)).toBe('Ctrl+Shift+S');
    });

    it('ignores standalone modifier keys', () => {
      const event = new KeyboardEvent('keydown', {
        key: 'Control',
        ctrlKey: true,
      });
      expect(hotkeyFromKeyboardEvent(event)).toBeNull();
    });

    it('normalizes spacebar', () => {
      const event = new KeyboardEvent('keydown', {
        key: ' ',
      });
      expect(hotkeyFromKeyboardEvent(event)).toBe('Space');
    });
  });
});
