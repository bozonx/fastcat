// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  stringifyHotkey,
  parseHotkeyCombo,
  normalizeHotkeyCombo,
  isEditableTarget,
  hotkeyFromKeyboardEvent,
} from '~/utils/hotkeys/hotkeyUtils';

describe('stringifyHotkey', () => {
  it('builds combo string from normalized hotkey', () => {
    expect(stringifyHotkey({ ctrl: true, meta: false, shift: true, alt: false, key: 'a' })).toBe(
      'Ctrl+Shift+A',
    );
    expect(
      stringifyHotkey({ ctrl: false, meta: false, shift: false, alt: false, key: 'Enter' }),
    ).toBe('Enter');
  });

  it('normalizes key labels', () => {
    expect(stringifyHotkey({ ctrl: false, meta: false, shift: false, alt: false, key: ' ' })).toBe(
      'Space',
    );
    expect(
      stringifyHotkey({ ctrl: false, meta: false, shift: false, alt: false, key: 'esc' }),
    ).toBe('Escape');
  });
});

describe('parseHotkeyCombo', () => {
  it('parses combo string into normalized hotkey', () => {
    expect(parseHotkeyCombo('Ctrl+Shift+A')).toEqual({
      ctrl: true,
      meta: false,
      shift: true,
      alt: false,
      key: 'A',
    });
    expect(parseHotkeyCombo('Enter')).toEqual({
      ctrl: false,
      meta: false,
      shift: false,
      alt: false,
      key: 'Enter',
    });
  });

  it('returns null for invalid combos', () => {
    expect(parseHotkeyCombo('')).toBeNull();
    expect(parseHotkeyCombo('Ctrl+Shift')).toBeNull();
  });
});

describe('normalizeHotkeyCombo', () => {
  it('round-trips through parse and stringify', () => {
    expect(normalizeHotkeyCombo('Shift+Ctrl+A')).toBe('Ctrl+Shift+A');
    expect(normalizeHotkeyCombo('a')).toBe('A');
  });

  it('returns null for invalid combos', () => {
    expect(normalizeHotkeyCombo('')).toBeNull();
  });
});

describe('isEditableTarget', () => {
  it('returns false for non-element targets', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });

  it('detects content editable elements', () => {
    const el = document.createElement('div');
    el.contentEditable = 'true';
    expect(isEditableTarget(el)).toBe(true);
  });

  it('detects text inputs as editable', () => {
    const input = document.createElement('input');
    input.type = 'text';
    expect(isEditableTarget(input)).toBe(true);
  });

  it('detects checkbox as non-editable', () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    expect(isEditableTarget(input)).toBe(false);
  });
});
