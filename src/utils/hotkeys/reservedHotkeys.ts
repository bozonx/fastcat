import { isTauriRuntime } from '~/utils/runtime';
import { isEmbedRuntime } from '~/utils/embed-runtime';

import { normalizeHotkeyCombo, parseHotkeyCombo } from './hotkeyUtils';

export type HotkeyReservationRuntime = 'browser' | 'tauri' | 'embed';

export interface HotkeyReservation {
  runtime: HotkeyReservationRuntime;
}

const BROWSER_RESERVED_COMBOS = new Set([
  'Alt+ArrowLeft',
  'Alt+ArrowRight',
  'Ctrl+D',
  'Ctrl+F5',
  'Ctrl+H',
  'Ctrl+J',
  'Ctrl+L',
  'Ctrl+N',
  'Ctrl+P',
  'Ctrl+PageDown',
  'Ctrl+PageUp',
  'Ctrl+R',
  'Ctrl+Shift+C',
  'Ctrl+Shift+Delete',
  'Ctrl+Shift+I',
  'Ctrl+Shift+J',
  'Ctrl+Shift+N',
  'Ctrl+Shift+R',
  'Ctrl+Shift+Tab',
  'Ctrl+Shift+T',
  'Ctrl+T',
  'Ctrl+Tab',
  'Ctrl+U',
  'Ctrl+W',
  'F1',
  'F5',
  'F6',
  'F11',
  'F12',
  'Meta+D',
  'Meta+H',
  'Meta+L',
  'Meta+N',
  'Meta+P',
  'Meta+R',
  'Meta+Shift+C',
  'Meta+Shift+I',
  'Meta+Shift+J',
  'Meta+Shift+N',
  'Meta+Shift+R',
  'Meta+Shift+Tab',
  'Meta+Shift+T',
  'Meta+T',
  'Meta+Tab',
  'Meta+U',
  'Meta+W',
]);

/**
 * Additionally unavailable inside a host page's iframe.
 *
 * The embedded editor shares its keyboard with the page around it, and the host
 * is the one that owns saving and closing. Binding these here would either be
 * swallowed by the host or fire in both places at once.
 */
const EMBED_RESERVED_COMBOS = new Set(['Ctrl+S', 'Meta+S', 'Ctrl+Shift+S', 'Meta+Shift+S']);

const TAURI_RESERVED_COMBOS = new Set([
  'Alt+F4',
  'Alt+Space',
  'Meta+H',
  'Meta+M',
  'Meta+Q',
  'Meta+Space',
  'Meta+Tab',
]);

function getComparableCombos(combo: string): string[] {
  const normalized = normalizeHotkeyCombo(combo);
  if (!normalized) return [];

  const parsed = parseHotkeyCombo(normalized);
  if (!parsed) return [normalized];

  const combos = new Set([normalized]);

  if (parsed.ctrl && !parsed.meta) {
    combos.add(
      normalizeHotkeyCombo(
        ['Meta', parsed.alt ? 'Alt' : '', parsed.shift ? 'Shift' : '', parsed.key]
          .filter(Boolean)
          .join('+'),
      ) ?? normalized,
    );
  }

  if (parsed.meta && !parsed.ctrl) {
    combos.add(
      normalizeHotkeyCombo(
        ['Ctrl', parsed.alt ? 'Alt' : '', parsed.shift ? 'Shift' : '', parsed.key]
          .filter(Boolean)
          .join('+'),
      ) ?? normalized,
    );
  }

  return [...combos];
}

export function getReservedHotkeyReservation(combo: string): HotkeyReservation | null {
  const comparableCombos = getComparableCombos(combo);

  if (isTauriRuntime()) {
    return comparableCombos.some((value) => TAURI_RESERVED_COMBOS.has(value))
      ? { runtime: 'tauri' }
      : null;
  }

  if (isEmbedRuntime() && comparableCombos.some((value) => EMBED_RESERVED_COMBOS.has(value))) {
    return { runtime: 'embed' };
  }

  return comparableCombos.some((value) => BROWSER_RESERVED_COMBOS.has(value))
    ? { runtime: 'browser' }
    : null;
}
