import { useWorkspaceStore } from '~/stores/workspace.store';
import type { HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import { formatHotkeyComboForDisplay } from '~/utils/hotkeys/hotkeyUtils';
import { isMacPlatform } from '~/utils/runtime';

const isMac = isMacPlatform();

function formatHotkey(
  combo: string,
  settings: ReturnType<typeof useWorkspaceStore>['userSettings'],
): string {
  // formatHotkeyComboForDisplay already renders macOS glyphs (⌘/⌥/⇧/␣).
  return formatHotkeyComboForDisplay(combo, settings);
}

export function useHotkeyLabel() {
  const workspaceStore = useWorkspaceStore();

  function getHotkeySettings() {
    return {
      ...workspaceStore.userSettings.hotkeys,
      bindings: workspaceStore.userSettings.hotkeys?.bindings ?? {},
    };
  }

  function getHotkeyLabel(commandId: HotkeyCommandId): string | null {
    const effective = getEffectiveHotkeyBindings(getHotkeySettings());
    const bindings = effective[commandId];
    if (!bindings || bindings.length === 0) return null;
    return bindings.map((combo) => formatHotkey(combo, workspaceStore.userSettings)).join(', ');
  }

  function getHotkeyKbds(commandId: HotkeyCommandId): string[] | undefined {
    const effective = getEffectiveHotkeyBindings(getHotkeySettings());
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
