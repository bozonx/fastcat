import type { HotkeyCombo } from './defaultHotkeys';

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
  const key = rawKey.trim();
  if (!key) return '';

  const lower = key.toLowerCase();

  if (lower === ' ') return 'Space';
  if (lower === 'spacebar') return 'Space';
  if (lower === 'esc') return 'Escape';
  if (lower === 'del') return 'Delete';

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

export function hotkeyFromKeyboardEvent(e: KeyboardEvent): HotkeyCombo | null {
  const key = normalizeKeyLabel(e.key);
  if (!key) return null;

  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') {
    return null;
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
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(el.isContentEditable);
}
