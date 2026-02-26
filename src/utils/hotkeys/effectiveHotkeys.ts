import { DEFAULT_HOTKEYS, type HotkeyCommandId, type HotkeyCombo } from './defaultHotkeys';

export interface HotkeysState {
  bindings: Partial<Record<HotkeyCommandId, HotkeyCombo[]>>;
}

export function getEffectiveHotkeyBindings(state: HotkeysState): Record<HotkeyCommandId, HotkeyCombo[]> {
  const result: Record<HotkeyCommandId, HotkeyCombo[]> = {} as any;

  for (const cmd of DEFAULT_HOTKEYS.commands) {
    const override = state.bindings[cmd.id];
    if (Array.isArray(override)) {
      result[cmd.id] = [...override];
      continue;
    }

    result[cmd.id] = [...(DEFAULT_HOTKEYS.bindings[cmd.id] ?? [])];
  }

  return result;
}
