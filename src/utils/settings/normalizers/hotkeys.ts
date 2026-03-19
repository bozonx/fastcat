import { z } from 'zod';
import { DEFAULT_USER_SETTINGS, type FastCatUserSettings } from '../defaults';
import {
  DEFAULT_HOTKEYS,
  type HotkeyCommandId,
  type HotkeyCombo,
} from '../../hotkeys/defaultHotkeys';
import { normalizeHotkeyCombo } from '../../hotkeys/hotkeyUtils';

const modifierKeysSchema = z.enum([
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

export function normalizeHotkeys(raw: unknown): FastCatUserSettings['hotkeys'] {
  const schema = z
    .object({
      layer1: modifierKeysSchema.catch(DEFAULT_USER_SETTINGS.hotkeys.layer1),
      layer2: modifierKeysSchema.catch(DEFAULT_USER_SETTINGS.hotkeys.layer2),
      bindings: z
        .record(
          z.string(),
          z
            .array(
              z
                .string()
                .transform(normalizeHotkeyCombo)
                .transform((v) => (v ? v : null)),
            )
            .transform((arr) => arr.filter((x): x is HotkeyCombo => x !== null)),
        )
        .transform((val) => {
          const normalizedBindings: Partial<Record<HotkeyCommandId, HotkeyCombo[]>> = {};
          const allowedCommands = new Set<HotkeyCommandId>(
            DEFAULT_HOTKEYS.commands.map((command) => command.id),
          );

          for (const [cmdIdRaw, combosRaw] of Object.entries(val)) {
            const cmdId = cmdIdRaw as HotkeyCommandId;
            if (!allowedCommands.has(cmdId)) continue;
            normalizedBindings[cmdId] = Array.from(new Set(combosRaw));
          }
          return normalizedBindings;
        })
        .catch({}),
    })
    .catch({
      layer1: DEFAULT_USER_SETTINGS.hotkeys.layer1,
      layer2: DEFAULT_USER_SETTINGS.hotkeys.layer2,
      bindings: {},
    });

  return schema.parse(raw ?? {});
}
