import { DEFAULT_HOTKEYS, type HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';

const isMac =
  typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

function formatHotkey(combo: string): string {
  if (!isMac) return combo;

  return combo
    .replace(/\bCtrl\b/g, '⌘')
    .replace(/\bMeta\b/g, '⌘')
    .replace(/\bAlt\b/g, '⌥')
    .replace(/\bShift\b/g, '⇧')
    .replace(/\bSpace\b/g, '␣');
}

function getDefaultBinding(commandId: HotkeyCommandId): string | null {
  const bindings = DEFAULT_HOTKEYS.bindings[commandId];
  if (!bindings || bindings.length === 0) return null;
  return bindings[0] ?? null;
}

export function useHotkeyLabel() {
  function getHotkeyLabel(commandId: HotkeyCommandId): string | null {
    const binding = getDefaultBinding(commandId);
    if (!binding) return null;
    return formatHotkey(binding);
  }

  function getHotkeyTitle(baseTitle: string, commandId: HotkeyCommandId): string {
    const label = getHotkeyLabel(commandId);
    if (!label) return baseTitle;
    return `${baseTitle} (${label})`;
  }

  return {
    getHotkeyLabel,
    getHotkeyTitle,
    isMac,
  };
}
