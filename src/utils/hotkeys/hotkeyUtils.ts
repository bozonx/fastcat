import type { FastCatUserSettings } from '../settings/defaults';
import type { HotkeyCombo } from './defaultHotkeys';
import { isLayer1Active, isLayer2Active } from './layerUtils';

export interface NormalizedHotkey {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

const MOD_ORDER = ['Ctrl', 'Meta', 'Alt', 'Shift'] as const;

type ModLabel = (typeof MOD_ORDER)[number];

function normalizeKeyLabel(rawKey: string): string {
  if (rawKey === ' ') return 'Space';

  const key = rawKey.trim();
  if (!key) return '';

  const lower = key.toLowerCase();

  if (lower === 'spacebar') return 'Space';
  if (lower === 'esc') return 'Escape';
  if (lower === 'del') return 'Delete';

  if (key.startsWith('Key') && key.length === 4) {
    return key.slice(3);
  }
  if (key.startsWith('Digit') && key.length === 6) {
    return key.slice(5);
  }
  if (key.startsWith('Numpad') && key.length > 6) {
    return `Numpad${key.slice(6)}`;
  }

  if (lower.length === 1) {
    return lower.toUpperCase();
  }

  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function stringifyHotkey(input: NormalizedHotkey): HotkeyCombo {
  const parts: string[] = [];
  if (input.ctrl) parts.push('Ctrl');
  if (input.meta) parts.push('Meta');
  if (input.alt) parts.push('Alt');
  if (input.shift) parts.push('Shift');

  const key = normalizeKeyLabel(input.key);
  if (key) parts.push(key);

  return parts.join('+');
}

export function parseHotkeyCombo(combo: HotkeyCombo): NormalizedHotkey | null {
  if (!combo || typeof combo !== 'string') return null;

  const tokens = combo
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) return null;

  const mods = new Set<string>();
  let keyToken: string | null = null;

  for (const token of tokens) {
    const normalized = normalizeKeyLabel(token);
    if (!normalized) continue;

    if (MOD_ORDER.includes(normalized as ModLabel)) {
      mods.add(normalized);
      continue;
    }

    keyToken = normalized;
  }

  if (!keyToken) return null;

  return {
    ctrl: mods.has('Ctrl'),
    meta: mods.has('Meta'),
    alt: mods.has('Alt'),
    shift: mods.has('Shift'),
    key: keyToken,
  };
}

export function normalizeHotkeyCombo(combo: HotkeyCombo): HotkeyCombo | null {
  const parsed = parseHotkeyCombo(combo);
  if (!parsed) return null;
  return stringifyHotkey(parsed);
}

export function hotkeyFromKeyboardEvent(
  e: KeyboardEvent,
  settings?: FastCatUserSettings,
): HotkeyCombo | null {
  const useCode =
    e.code.startsWith('Key') || e.code.startsWith('Digit') || e.code.startsWith('Numpad');
  const key = normalizeKeyLabel(useCode ? e.code : e.key);
  if (!key) return null;

  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
    return null;
  }

  // If settings are provided, use virtual layers.
  // Layer 1 maps to virtual Shift, Layer 2 maps to virtual Ctrl.
  if (settings) {
    const isL1 = isLayer1Active(e, settings);
    const isL2 = isLayer2Active(e, settings);

    return stringifyHotkey({
      ctrl: isL2,
      meta: e.metaKey,
      alt: e.altKey,
      shift: isL1,
      key,
    });
  }

  return stringifyHotkey({
    ctrl: e.ctrlKey,
    meta: e.metaKey,
    alt: e.altKey,
    shift: e.shiftKey,
    key,
  });
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;

  if (el.isContentEditable) return true;

  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;

  if (tag !== 'INPUT') return false;

  const input = el as HTMLInputElement;
  const type = (input.type || '').toLowerCase();
  if (!type) return true; // Default input is text

  // Allow global hotkeys for non-text inputs
  const nonTextTypes = [
    'checkbox',
    'radio',
    'button',
    'submit',
    'reset',
    'color',
    'file',
    'image',
    'hidden',
    'range',
  ];
  if (nonTextTypes.includes(type)) return false;

  return true; // text, search, password, email, number, date, etc.
}
