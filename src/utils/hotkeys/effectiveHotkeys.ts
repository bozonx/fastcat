import { DEFAULT_HOTKEYS, type HotkeyCommandId, type HotkeyCombo } from './defaultHotkeys';
import { normalizeHotkeyCombo } from './hotkeyUtils';

export interface HotkeysState {
  bindings: Partial<Record<HotkeyCommandId, HotkeyCombo[]>>;
}

export function getEffectiveHotkeyBindings(
  state: HotkeysState,
): Record<HotkeyCommandId, HotkeyCombo[]> {
  const result: Record<HotkeyCommandId, HotkeyCombo[]> = {} as any;

  const normalizeList = (list: HotkeyCombo[]) => {
    const normalized = list
      .map((c) => normalizeHotkeyCombo(c))
      .filter((c): c is HotkeyCombo => Boolean(c));
    return Array.from(new Set(normalized));
  };

  for (const cmd of DEFAULT_HOTKEYS.commands) {
    const override = state.bindings[cmd.id];
    if (Array.isArray(override)) {
      result[cmd.id] = normalizeList(override);
      continue;
    }

    result[cmd.id] = normalizeList(DEFAULT_HOTKEYS.bindings[cmd.id] ?? []);
  }

  return result;
}
