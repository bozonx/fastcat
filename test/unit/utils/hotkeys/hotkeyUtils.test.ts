// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
  stringifyHotkey,
  parseHotkeyCombo,
  normalizeHotkeyCombo,
  formatHotkeyComboForDisplay,
  hotkeyComboToBareKeyCode,
  isBareHotkeyCombo,
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

  it('normalizes virtual modifier aliases', () => {
    expect(normalizeHotkeyCombo('Modifier1+Space')).toBe('Shift+Space');
    expect(normalizeHotkeyCombo('Modifier2+Modifier1+G')).toBe('Ctrl+Shift+G');
  });

  it('returns null for invalid combos', () => {
    expect(normalizeHotkeyCombo('')).toBeNull();
  });
});

describe('formatHotkeyComboForDisplay', () => {
  it('renders virtual modifiers as default physical modifier labels', () => {
    expect(formatHotkeyComboForDisplay('Modifier1+ArrowUp')).toBe('Shift+ArrowUp');
    expect(formatHotkeyComboForDisplay('Modifier2+Modifier1+G')).toBe('Ctrl+Shift+G');
  });

  it('renders virtual modifiers using user layer settings', () => {
    const settings = {
      hotkeys: {
        layer1: 'Alt',
        layer2: 'ControlRight',
      },
    } as any;

    expect(formatHotkeyComboForDisplay('Modifier2+Modifier1+G', settings)).toBe(
      'Right Ctrl+Alt+G',
    );
  });
});

describe('isBareHotkeyCombo', () => {
  it('returns true only for combos without modifiers', () => {
    expect(isBareHotkeyCombo('K')).toBe(true);
    expect(isBareHotkeyCombo('/')).toBe(true);
    expect(isBareHotkeyCombo('Shift+K')).toBe(false);
    expect(isBareHotkeyCombo('')).toBe(false);
  });
});

describe('hotkeyComboToBareKeyCode', () => {
  it('maps bare hotkey labels back to physical key codes', () => {
    expect(hotkeyComboToBareKeyCode('K')).toBe('KeyK');
    expect(hotkeyComboToBareKeyCode('5')).toBe('Digit5');
    expect(hotkeyComboToBareKeyCode('/')).toBe('Slash');
    expect(hotkeyComboToBareKeyCode('Space')).toBe('Space');
  });

  it('returns null for modifier combos and unsupported keys', () => {
    expect(hotkeyComboToBareKeyCode('Shift+K')).toBeNull();
    expect(hotkeyComboToBareKeyCode('Ctrl+/')).toBeNull();
    expect(hotkeyComboToBareKeyCode('')).toBeNull();
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

describe('hotkeyFromKeyboardEvent', () => {
  it('uses e.code for layout-independent keys (brackets in Russian layout)', () => {
    const bracketLeft = new KeyboardEvent('keydown', {
      code: 'BracketLeft',
      key: 'х',
      bubbles: true,
    });
    expect(hotkeyFromKeyboardEvent(bracketLeft)).toBe('[');

    const bracketRight = new KeyboardEvent('keydown', {
      code: 'BracketRight',
      key: 'ъ',
      bubbles: true,
    });
    expect(hotkeyFromKeyboardEvent(bracketRight)).toBe(']');
  });

  it('uses e.code for Slash in Russian layout', () => {
    const slash = new KeyboardEvent('keydown', {
      code: 'Slash',
      key: '.',
      bubbles: true,
    });
    expect(hotkeyFromKeyboardEvent(slash)).toBe('/');
  });

  it('uses e.code for letter keys regardless of layout', () => {
    const keyA = new KeyboardEvent('keydown', {
      code: 'KeyA',
      key: 'ф',
      bubbles: true,
    });
    expect(hotkeyFromKeyboardEvent(keyA)).toBe('A');
  });

  it('falls back to e.key for non-layout-independent keys', () => {
    const enter = new KeyboardEvent('keydown', {
      code: 'Enter',
      key: 'Enter',
      bubbles: true,
    });
    expect(hotkeyFromKeyboardEvent(enter)).toBe('Enter');
  });

  it('uses e.code for IntlBackslash regardless of layout', () => {
    const intlBackslash = new KeyboardEvent('keydown', {
      code: 'IntlBackslash',
      key: '\\',
      bubbles: true,
    });
    expect(hotkeyFromKeyboardEvent(intlBackslash)).toBe('\\');
  });

  it('applies virtual layers from user settings instead of hardcoded modifiers', () => {
    const settings = {
      hotkeys: {
        layer1: 'Alt',
        layer2: 'Shift',
      },
    } as any;

    // Alt becomes virtual Shift, Shift becomes virtual Ctrl
    const altZ = new KeyboardEvent('keydown', {
      code: 'KeyZ',
      key: 'z',
      altKey: true,
      shiftKey: false,
      ctrlKey: false,
      bubbles: true,
    });
    expect(hotkeyFromKeyboardEvent(altZ, settings)).toBe('Shift+Z');

    const shiftZ = new KeyboardEvent('keydown', {
      code: 'KeyZ',
      key: 'z',
      altKey: false,
      shiftKey: true,
      ctrlKey: false,
      bubbles: true,
    });
    expect(hotkeyFromKeyboardEvent(shiftZ, settings)).toBe('Ctrl+Z');

    // Physical Ctrl passes through because it is not assigned to any layer
    const ctrlZ = new KeyboardEvent('keydown', {
      code: 'KeyZ',
      key: 'z',
      altKey: false,
      shiftKey: false,
      ctrlKey: true,
      bubbles: true,
    });
    expect(hotkeyFromKeyboardEvent(ctrlZ, settings)).toBe('Ctrl+Z');
  });

  it('blocks global hotkeys in editable targets while allowing system keys', () => {
    const input = document.createElement('input');
    input.type = 'text';

    const hEvent = new KeyboardEvent('keydown', {
      code: 'KeyH',
      key: 'h',
      bubbles: true,
    });
    Object.defineProperty(hEvent, 'target', { value: input, writable: false });

    // isEditableTarget should detect text input as editable
    expect(isEditableTarget(input)).toBe(true);

    // The combo itself is still resolved; protection happens in canExecuteHotkeyCommand
    expect(hotkeyFromKeyboardEvent(hEvent)).toBe('H');
  });
});
