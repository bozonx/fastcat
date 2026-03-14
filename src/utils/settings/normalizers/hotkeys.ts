import { DEFAULT_USER_SETTINGS, type FastCatUserSettings } from '../defaults';
import { DEFAULT_HOTKEYS, type HotkeyCommandId, type HotkeyCombo } from '../../hotkeys/defaultHotkeys';
import { normalizeHotkeyCombo } from '../../hotkeys/hotkeyUtils';
import { asRecord } from './shared';

export function normalizeHotkeys(raw: unknown): FastCatUserSettings['hotkeys'] {
  if (!raw || typeof raw !== 'object') {
    return {
      layer1: DEFAULT_USER_SETTINGS.hotkeys.layer1,
      layer2: DEFAULT_USER_SETTINGS.hotkeys.layer2,
      bindings: {},
    };
  }

  const input = asRecord(raw);
  const layer1 =
    typeof input.layer1 === 'string' &&
    input.layer1 in { [DEFAULT_USER_SETTINGS.hotkeys.layer1]: true }
      ? (input.layer1 as FastCatUserSettings['hotkeys']['layer1'])
      : DEFAULT_USER_SETTINGS.hotkeys.layer1;
  const layer2 =
    typeof input.layer2 === 'string' &&
    input.layer2 in { [DEFAULT_USER_SETTINGS.hotkeys.layer2]: true }
      ? (input.layer2 as FastCatUserSettings['hotkeys']['layer2'])
      : DEFAULT_USER_SETTINGS.hotkeys.layer2;
  const bindingsInput = input.bindings;

  if (!bindingsInput || typeof bindingsInput !== 'object') {
    return {
      layer1,
      layer2,
      bindings: {},
    };
  }

  const normalizedBindings: Partial<Record<HotkeyCommandId, HotkeyCombo[]>> = {};
  const allowedCommands = new Set<HotkeyCommandId>(DEFAULT_HOTKEYS.commands.map((command) => command.id));

  for (const [cmdIdRaw, combosRaw] of Object.entries(bindingsInput)) {
    const cmdId = cmdIdRaw as HotkeyCommandId;
    if (!allowedCommands.has(cmdId)) continue;

    const combos = Array.isArray(combosRaw) ? combosRaw : [];
    const normalizedCombos = combos
      .filter((combo): combo is string => typeof combo === 'string')
      .map((combo) => normalizeHotkeyCombo(combo))
      .filter((combo): combo is string => Boolean(combo));

    if (normalizedCombos.length > 0) {
      normalizedBindings[cmdId] = Array.from(new Set(normalizedCombos));
      continue;
    }

    if (Array.isArray(combosRaw)) {
      normalizedBindings[cmdId] = [];
    }
  }

  return {
    layer1,
    layer2,
    bindings: normalizedBindings,
  };
}
