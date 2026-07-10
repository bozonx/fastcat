import { useWorkspaceStore } from '~/stores/workspace.store';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import { formatHotkeyComboForDisplay } from '~/utils/hotkeys/hotkeyUtils';

const isMac =
  typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;

function formatHotkey(
  combo: string,
  settings: ReturnType<typeof useWorkspaceStore>['userSettings'],
): string {
  const display = formatHotkeyComboForDisplay(combo, settings);
  if (!isMac) return display;

  return display
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
    return bindings.map((combo) => formatHotkey(combo, workspaceStore.userSettings)).join(', ');
  }

  function getHotkeyKbds(commandId: HotkeyCommandId): string[] | undefined {
    const effective = getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys);
    const bindings = effective[commandId];
    if (!bindings || bindings.length === 0) return undefined;
    const firstBinding = bindings[0];
    if (!firstBinding) return undefined;
    return formatHotkey(firstBinding, workspaceStore.userSettings).split('+');
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
