import { useWorkspaceStore } from '~/stores/workspace.store';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';

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

export function useHotkeyLabel() {
  const workspaceStore = useWorkspaceStore();

  function getHotkeyLabel(commandId: HotkeyCommandId): string | null {
    const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);
    const bindings = effective[commandId];
    if (!bindings || bindings.length === 0) return null;
    return bindings.map(formatHotkey).join(', ');
  }

  function getHotkeyKbds(commandId: HotkeyCommandId): string[] | undefined {
    const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);
    const bindings = effective[commandId];
    if (!bindings || bindings.length === 0) return undefined;
    const firstBinding = bindings[0];
    if (!firstBinding) return undefined;
    return firstBinding.split('+').map(formatHotkey);
  }

  function getHotkeyTitle(baseTitle: string, commandId: HotkeyCommandId): string {
    const label = getHotkeyLabel(commandId);
    if (!label) return baseTitle;
    return `${baseTitle} (${label})`;
  }

  return {
    getHotkeyLabel,
    getHotkeyKbds,
    getHotkeyTitle,
    isMac,
  };
}
