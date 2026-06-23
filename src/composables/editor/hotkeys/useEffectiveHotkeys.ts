import { computed, type ComputedRef } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { DEFAULT_HOTKEYS } from '~/utils/hotkeys/defaultHotkeys';
import { getEffectiveHotkeyBindings } from '~/utils/hotkeys/effectiveHotkeys';
import {
  createDefaultHotkeyLookup,
  createHotkeyLookup,
  type HotkeyLookup,
} from '~/utils/hotkeys/runtime';

export interface EffectiveHotkeys {
  /** Lookup honouring the user's customised bindings. */
  hotkeyLookup: ComputedRef<HotkeyLookup>;
  /** Lookup for the built-in default bindings. */
  defaultHotkeyLookup: ComputedRef<HotkeyLookup>;
}

/**
 * Shared hotkey-lookup boilerplate used across the editor/timeline/file-manager
 * drag and hotkey composables. Returns reactive lookups derived from the user's
 * current hotkey settings plus the built-in defaults.
 */
export function useEffectiveHotkeys(): EffectiveHotkeys {
  const workspaceStore = useWorkspaceStore();

  const commandOrder = DEFAULT_HOTKEYS.commands.map((c) => c.id);
  const effectiveHotkeys = computed(() =>
    getEffectiveHotkeyBindings(workspaceStore.userSettings.hotkeys),
  );
  const hotkeyLookup = computed(() => createHotkeyLookup(effectiveHotkeys.value, commandOrder));
  const defaultHotkeyLookup = computed(() => createDefaultHotkeyLookup(commandOrder));

  return { hotkeyLookup, defaultHotkeyLookup };
}
