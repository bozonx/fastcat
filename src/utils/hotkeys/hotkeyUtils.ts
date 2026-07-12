import { isMacPlatform } from '../runtime';
import type { FastCatUserSettings } from '../settings/defaults';
import type { HotkeyCombo } from './defaultHotkeys';
import type { LayerKey } from './layerUtils';
import { isLayer1Active, isLayer2Active } from './layerUtils';

interface EventModifierState {
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Normalise the physical modifier flags of a keyboard/mouse event.
 *
 * Bindings are stored with the primary command modifier as `Ctrl` (from
 * `Modifier2`). On macOS the primary modifier is Cmd, so we map the physical
 * Meta key onto the virtual `ctrl` slot and drop physical Control entirely —
 * Ctrl-based shortcuts stay inert, matching native Mac apps. On every other
 * platform the flags pass through unchanged.
 */
function readEventModifiers(e: KeyboardEvent | MouseEvent | WheelEvent): EventModifierState {
  if (isMacPlatform()) {
    return { ctrlKey: e.metaKey, metaKey: false, altKey: e.altKey, shiftKey: e.shiftKey };
  }
  return { ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, shiftKey: e.shiftKey };
}

export interface NormalizedHotkey {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

const MOD_ORDER = ['Ctrl', 'Meta', 'Alt', 'Shift'] as const;

type ModLabel = (typeof MOD_ORDER)[number];

const CODE_TO_LABEL: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Backslash: '\\',
  Period: '.',
  Comma: ',',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  IntlBackslash: '\\',
};

const LABEL_TO_CODE: Record<string, string> = {
  ...Object.fromEntries(Object.entries(CODE_TO_LABEL).map(([code, label]) => [label, code])),
  '\\': 'Backslash',
  Space: 'Space',
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Arrowup: 'ArrowUp',
  Arrowdown: 'ArrowDown',
  Arrowleft: 'ArrowLeft',
  Arrowright: 'ArrowRight',
  Home: 'Home',
  End: 'End',
  Pageup: 'PageUp',
  Pagedown: 'PageDown',
};

const KEY_LABEL_NORMALIZATION: Record<string, string> = {
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

function normalizeKeyLabel(rawKey: string): string {
  const codeLabel = CODE_TO_LABEL[rawKey];
  if (codeLabel) return codeLabel;

  if (rawKey === ' ') return 'Space';

  const key = rawKey.trim();
  if (!key) return '';

  const lower = key.toLowerCase();

  const normalizedSpecialKey = KEY_LABEL_NORMALIZATION[lower];
  if (normalizedSpecialKey) return normalizedSpecialKey;

  if (lower === 'modifier1' || lower === 'mod1' || lower === 'layer1') return 'Shift';
  if (lower === 'modifier2' || lower === 'mod2' || lower === 'layer2') return 'Ctrl';
  if (lower === 'control') return 'Ctrl';
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

function formatLayerKey(layerKey: LayerKey): string {
  if (layerKey === 'Control') return 'Ctrl';
  if (layerKey === 'Shift' || layerKey === 'Alt' || layerKey === 'Meta') return layerKey;

  const side = layerKey.endsWith('Left') ? 'Left' : 'Right';
  const key = layerKey.replace('Left', '').replace('Right', '').replace('Control', 'Ctrl');

  return `${side} ${key}`;
}

function formatHotkeyTokenForDisplay(
  token: string,
  settings?: Pick<FastCatUserSettings, 'hotkeys'>,
): string {
  const normalized = normalizeKeyLabel(token);
  const lower = token.trim().toLowerCase();

  if (lower === 'modifier1' || lower === 'mod1' || lower === 'layer1') {
    return formatLayerKey(settings?.hotkeys.layer1 ?? 'Shift');
  }

  if (lower === 'modifier2' || lower === 'mod2' || lower === 'layer2') {
    return formatLayerKey(settings?.hotkeys.layer2 ?? 'Control');
  }

  return normalized;
}

/**
 * On macOS render modifier words as their conventional glyphs. `Ctrl` maps to
 * ⌘ because the stored `Ctrl` binding is driven by the Cmd key on Mac (see
 * {@link hotkeyFromKeyboardEvent}); `Meta` also maps to ⌘ for completeness.
 */
function applyMacGlyphs(display: string): string {
  return display
    .replace(/\bCtrl\b/g, '⌘')
    .replace(/\bMeta\b/g, '⌘')
    .replace(/\bAlt\b/g, '⌥')
    .replace(/\bShift\b/g, '⇧')
    .replace(/\bSpace\b/g, '␣');
}

export function formatHotkeyComboForDisplay(
  combo: HotkeyCombo,
  settings?: Pick<FastCatUserSettings, 'hotkeys'>,
): string {
  const display = combo
    .split('+')
    .map((token) => formatHotkeyTokenForDisplay(token, settings))
    .filter(Boolean)
    .join('+');

  return isMacPlatform() ? applyMacGlyphs(display) : display;
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

export function isBareHotkeyCombo(combo: HotkeyCombo): boolean {
  const parsed = parseHotkeyCombo(combo);
  if (!parsed) return false;

  return !parsed.ctrl && !parsed.meta && !parsed.alt && !parsed.shift;
}

export function hotkeyComboToBareKeyCode(combo: HotkeyCombo): string | null {
  const parsed = parseHotkeyCombo(combo);
  if (!parsed || parsed.ctrl || parsed.meta || parsed.alt || parsed.shift) return null;

  if (/^[A-Z]$/.test(parsed.key)) return `Key${parsed.key}`;
  if (/^[0-9]$/.test(parsed.key)) return `Digit${parsed.key}`;
  if (/^Numpad[A-Za-z0-9]+$/.test(parsed.key)) return parsed.key;

  return LABEL_TO_CODE[parsed.key] ?? null;
}

const LAYOUT_INDEPENDENT_CODES = [
  'BracketLeft',
  'BracketRight',
  'Slash',
  'Backslash',
  'Period',
  'Comma',
  'Semicolon',
  'Quote',
  'Backquote',
  'Minus',
  'Equal',
  'IntlBackslash',
];

export function hotkeyFromKeyboardEvent(
  e: KeyboardEvent,
  settings?: FastCatUserSettings,
): HotkeyCombo | null {
  const useCode =
    e.code.startsWith('Key') ||
    e.code.startsWith('Digit') ||
    e.code.startsWith('Numpad') ||
    LAYOUT_INDEPENDENT_CODES.includes(e.code);
  const key = normalizeKeyLabel(useCode ? e.code : e.key);
  if (!key) return null;

  if (key === 'Ctrl' || key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
    return null;
  }

  // Physical modifier flags, normalised for the platform (Cmd → Ctrl on macOS).
  const mods = readEventModifiers(e);

  // If settings are provided, use virtual layers.
  // Layer 1 maps to virtual Shift, Layer 2 maps to virtual Ctrl.
  if (settings) {
    // Layer activity is evaluated against the normalised modifiers so that on
    // macOS a layer assigned to Control is driven by the Cmd key (and physical
    // Control stays inert). Side-specific layers (e.g. ControlLeft) still read
    // raw pressed key codes inside isLayerActive.
    const layerEvent = { ...mods } as unknown as KeyboardEvent;
    const isL1 = isLayer1Active(layerEvent, settings);
    const isL2 = isLayer2Active(layerEvent, settings);

    // Identify which physical modifiers are assigned to layers
    const l1Phys = settings.hotkeys.layer1;
    const l2Phys = settings.hotkeys.layer2;

    // A physical modifier assigned to a layer is consumed by that layer and is
    // no longer passed through literally (otherwise it would be double-counted,
    // e.g. a Meta layer producing "Ctrl+Meta+…").
    const isAltLayer =
      l1Phys?.startsWith('Alt') ||
      l2Phys?.startsWith('Alt') ||
      l1Phys === 'Alt' ||
      l2Phys === 'Alt';
    const isShiftLayer =
      l1Phys?.startsWith('Shift') ||
      l2Phys?.startsWith('Shift') ||
      l1Phys === 'Shift' ||
      l2Phys === 'Shift';
    const isCtrlLayer =
      l1Phys?.startsWith('Control') ||
      l2Phys?.startsWith('Control') ||
      l1Phys === 'Control' ||
      l2Phys === 'Control';
    const isMetaLayer =
      l1Phys?.startsWith('Meta') ||
      l2Phys?.startsWith('Meta') ||
      l1Phys === 'Meta' ||
      l2Phys === 'Meta';

    return stringifyHotkey({
      ctrl: isL2 || (!isCtrlLayer && mods.ctrlKey),
      meta: !isMetaLayer && mods.metaKey,
      alt: !isAltLayer && mods.altKey,
      shift: isL1 || (!isShiftLayer && mods.shiftKey),
      key,
    });
  }

  return stringifyHotkey({
    ctrl: mods.ctrlKey,
    meta: mods.metaKey,
    alt: mods.altKey,
    shift: mods.shiftKey,
    key,
  });
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const el = target as HTMLElement;

  if (el.isContentEditable) return true;

  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;

  // Custom components (sliders, custom text inputs, comboboxes and listboxes).
  // Comboboxes accept typing and listboxes/comboboxes consume arrow keys for
  // their own navigation, so global bare-key hotkeys must stay out of them.
  const role = el.getAttribute('role');
  if (
    role === 'slider' ||
    role === 'textbox' ||
    role === 'spinbutton' ||
    role === 'combobox' ||
    role === 'listbox'
  ) {
    return true;
  }

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
    // 'range', // We want range inputs (sliders) to be treated as editable so hotkeys (arrows) are ignored
  ];
  if (nonTextTypes.includes(type)) return false;

  return true; // text, search, password, email, number, date, range, etc.
}
