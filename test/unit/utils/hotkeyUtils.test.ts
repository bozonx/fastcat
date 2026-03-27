import { describe, it, expect } from 'vitest';
import {
  parseHotkeyCombo,
  stringifyHotkey,
  normalizeHotkeyCombo,
  hotkeyFromKeyboardEvent,
  isEditableTarget,
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

    it('normalizes Ctrl+ArrowUp for file manager navigate up (Control is not a valid mod token)', () => {
      expect(normalizeHotkeyCombo('Ctrl+ArrowUp')).toBe('Ctrl+Arrowup');
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

    it('uses virtual layers if settings are provided', () => {
      const settings = {
        hotkeys: {
          layer1: 'Alt',
          layer2: 'Control',
        },
      } as any;

      const event = new KeyboardEvent('keydown', {
        key: 's',
        altKey: true, // layer 1
        ctrlKey: false,
      });

      // Layer 1 maps to Shift in the stringified hotkey
      expect(hotkeyFromKeyboardEvent(event, settings)).toBe('Shift+S');

      const event2 = new KeyboardEvent('keydown', {
        key: 's',
        altKey: false,
        ctrlKey: true, // layer 2
      });

      // Layer 2 maps to Ctrl in the stringified hotkey
      expect(hotkeyFromKeyboardEvent(event2, settings)).toBe('Ctrl+S');
    });
  });

  describe('isEditableTarget', () => {
    it('treats text inputs as editable', () => {
      const input = document.createElement('input');
      input.type = 'text';
      expect(isEditableTarget(input)).toBe(true);
    });

    it('treats textarea as editable', () => {
      const textarea = document.createElement('textarea');
      expect(isEditableTarget(textarea)).toBe(true);
    });

    it('treats contenteditable as editable', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      expect(isEditableTarget(div)).toBe(true);
    });

    it('treats select as editable', () => {
      const select = document.createElement('select');
      expect(isEditableTarget(select)).toBe(true);
    });

    it('treats range inputs (sliders) as editable', () => {
      const input = document.createElement('input');
      input.type = 'range';
      expect(isEditableTarget(input)).toBe(true);
    });

    it('treats number inputs as editable', () => {
      const input = document.createElement('input');
      input.type = 'number';
      expect(isEditableTarget(input)).toBe(true);
    });

    it('treats elements with role slider as editable', () => {
      const div = document.createElement('div');
      div.setAttribute('role', 'slider');
      expect(isEditableTarget(div)).toBe(true);
    });

    it('does not treat buttons as editable', () => {
      const button = document.createElement('button');
      expect(isEditableTarget(button)).toBe(false);
    });

    it('does not treat checkbox input as editable', () => {
      const input = document.createElement('input');
      input.type = 'checkbox';
      expect(isEditableTarget(input)).toBe(false);
    });
  });
});
