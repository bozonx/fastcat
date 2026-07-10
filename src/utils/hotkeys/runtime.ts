import type { AnyPanelFocus } from '~/stores/focus.store';
import type { HotkeyCommandId, HotkeyCombo, HotkeyGroupId } from './defaultHotkeys';
import { DEFAULT_HOTKEYS } from './defaultHotkeys';
import { hotkeyFromKeyboardEvent, normalizeHotkeyCombo, parseHotkeyCombo } from './hotkeyUtils';
import { isGlobalHotkeyGroup } from './scopes';
import type { FastCatUserSettings } from '../settings/defaults';

export interface HotkeyCommandPolicy {
  allowInEditable?: boolean;
  allowWhenModalOpen?: boolean;
  repeatable?: boolean;
  blurActiveElementOnExecute?: boolean;
}

export type HotkeyLookup = Readonly<Record<HotkeyCombo, HotkeyCommandId[]>>;

export const DEFAULT_HOTKEY_COMMAND_POLICY: Readonly<HotkeyCommandPolicy> = {
  allowInEditable: false,
  allowWhenModalOpen: false,
  repeatable: false,
  blurActiveElementOnExecute: false,
};

const EDITABLE_OVERRIDE_COMMANDS: readonly HotkeyCommandId[] = [
  'general.save',
  'general.mute',
  'general.volumeUp',
  'general.volumeDown',
];

const COMMAND_GROUPS: ReadonlyMap<HotkeyCommandId, HotkeyGroupId> = new Map(
  DEFAULT_HOTKEYS.commands.map((command) => [command.id, command.groupId]),
);

export function getHotkeyCommandGroup(cmdId: HotkeyCommandId): HotkeyGroupId | null {
  return COMMAND_GROUPS.get(cmdId) ?? null;
}

function comboHasCtrl(combo: HotkeyCombo | null | undefined): boolean {
  if (!combo) return false;
  const parsed = parseHotkeyCombo(combo);
  if (!parsed) return false;
  return parsed.ctrl;
}

export const HOTKEY_COMMAND_POLICIES: Readonly<
  Partial<Record<HotkeyCommandId, HotkeyCommandPolicy>>
> = {
  'general.deselect': {
    allowInEditable: true,
    blurActiveElementOnExecute: true,
  },
  'general.focus': {
    allowWhenModalOpen: false,
  },
  'general.rename': {
    allowInEditable: true,
    allowWhenModalOpen: false,
  },
  'general.fullscreen': {
    allowWhenModalOpen: true,
  },
  'general.zoomIn': {
    allowWhenModalOpen: true,
    repeatable: true,
  },
  'general.zoomOut': {
    allowWhenModalOpen: true,
    repeatable: true,
  },
  'general.zoomReset': {
    allowWhenModalOpen: true,
  },
  'general.zoomFit': {
    allowWhenModalOpen: true,
  },
};

export function getHotkeyCommandPolicy(cmdId: HotkeyCommandId): HotkeyCommandPolicy {
  return {
    ...DEFAULT_HOTKEY_COMMAND_POLICY,
    ...HOTKEY_COMMAND_POLICIES[cmdId],
  };
}

export function createHotkeyLookup(
  effective: Record<HotkeyCommandId, HotkeyCombo[]>,
  commandOrder: readonly HotkeyCommandId[],
  filter?: (cmdId: HotkeyCommandId) => boolean,
): HotkeyLookup {
  const lookup: Partial<Record<HotkeyCombo, HotkeyCommandId[]>> = {};

  for (const cmdId of commandOrder) {
    if (filter && !filter(cmdId)) continue;
    const bindings = effective[cmdId] ?? [];
    for (const combo of bindings) {
      if (!lookup[combo]) {
        lookup[combo] = [];
      }
      lookup[combo]!.push(cmdId);
    }
  }

  return lookup as HotkeyLookup;
}

export function createDefaultHotkeyLookup(commandOrder: readonly HotkeyCommandId[]): HotkeyLookup {
  const lookup: Partial<Record<HotkeyCombo, HotkeyCommandId[]>> = {};

  for (const cmdId of commandOrder) {
    const bindings = DEFAULT_HOTKEYS.bindings[cmdId] ?? [];
    for (const combo of bindings) {
      const normalized = normalizeHotkeyCombo(combo);
      if (!normalized) continue;
      if (!lookup[normalized]) {
        lookup[normalized] = [];
      }
      lookup[normalized]!.push(cmdId);
    }
  }

  return lookup as HotkeyLookup;
}

export function getFocusAwareHotkeyOrder(params: {
  matched: HotkeyCommandId[];
  canUseFileManagerHotkeys?: boolean;
  canUseTimelineHotkeys: boolean;
  canUseMonitorHotkeys?: boolean;
}): HotkeyCommandId[] {
  const activeLocalGroups: HotkeyGroupId[] = [];

  if (params.canUseFileManagerHotkeys) {
    activeLocalGroups.push('fileManager');
  }

  if (params.canUseTimelineHotkeys) {
    activeLocalGroups.push('timeline');
  }

  if (params.canUseMonitorHotkeys) {
    activeLocalGroups.push('monitor');
  }

  const activeLocal = params.matched.filter((cmdId) => {
    const groupId = COMMAND_GROUPS.get(cmdId);
    return groupId ? activeLocalGroups.includes(groupId) : false;
  });
  const global = params.matched.filter((cmdId) => {
    const groupId = COMMAND_GROUPS.get(cmdId);
    return groupId ? isGlobalHotkeyGroup(groupId) : false;
  });

  return [...activeLocal, ...global];
}

export function canExecuteHotkeyCommand(params: {
  cmdId: HotkeyCommandId;
  hasBlockingModalState: boolean;
  isEditableEventTarget: boolean;
  isEditableActiveElement: boolean;
  pressedCombo?: HotkeyCombo | null;
}): boolean {
  const {
    cmdId,
    hasBlockingModalState,
    isEditableEventTarget,
    isEditableActiveElement,
    pressedCombo,
  } = params;
  const policy = getHotkeyCommandPolicy(cmdId);

  if (hasBlockingModalState && !policy.allowWhenModalOpen) {
    return false;
  }

  if (!policy.allowInEditable && (isEditableEventTarget || isEditableActiveElement)) {
    if (EDITABLE_OVERRIDE_COMMANDS.includes(cmdId) && comboHasCtrl(pressedCombo)) {
      return true;
    }
    return false;
  }

  return true;
}

export function shouldHandleRepeatForMatchedCommands(matched: HotkeyCommandId[]): boolean {
  return matched.some((cmdId) => getHotkeyCommandPolicy(cmdId).repeatable);
}

export function shouldBlurAfterHotkey(params: {
  cmdId: HotkeyCommandId;
  activeElement: Element | null;
}): boolean {
  const { cmdId, activeElement } = params;
  const policy = getHotkeyCommandPolicy(cmdId);

  if (!policy.blurActiveElementOnExecute) {
    return false;
  }

  return activeElement instanceof HTMLElement;
}

export function getMatchedHotkeyCommands(params: {
  combo: HotkeyCombo | null;
  lookup: HotkeyLookup;
}): HotkeyCommandId[] {
  if (!params.combo) {
    return [];
  }

  return params.lookup[params.combo] ?? [];
}

export function isPreviewLikeFocus(focusId: AnyPanelFocus): boolean {
  if (
    focusId === 'left' ||
    focusId === 'right' ||
    focusId === 'project' ||
    focusId === 'filesBrowser' ||
    focusId === 'properties' ||
    focusId === 'files-sidebar' ||
    focusId === 'files-main'
  ) {
    return true;
  }

  if (String(focusId).startsWith('dynamic:')) {
    const parts = String(focusId).split(':');
    const type = parts[1];
    return (
      type === 'media' ||
      type === 'text' ||
      type === 'fileManager' ||
      type === 'file-manager' ||
      type === 'library' ||
      type === 'properties'
    );
  }

  return false;
}

export function isCommandMatched(params: {
  event: KeyboardEvent;
  cmdId: HotkeyCommandId;
  userSettings: FastCatUserSettings;
  hotkeyLookup: HotkeyLookup;
  defaultHotkeyLookup: HotkeyLookup;
}): boolean {
  const { event, cmdId, userSettings, hotkeyLookup, defaultHotkeyLookup } = params;

  const literalCombo = hotkeyFromKeyboardEvent(event);
  const layeredCombo = hotkeyFromKeyboardEvent(event, userSettings);

  if (literalCombo) {
    const matched = getMatchedHotkeyCommands({ combo: literalCombo, lookup: hotkeyLookup });
    if (matched.includes(cmdId)) return true;
  }

  if (layeredCombo && layeredCombo !== literalCombo) {
    const matched = getMatchedHotkeyCommands({
      combo: layeredCombo,
      lookup: defaultHotkeyLookup,
    });
    if (matched.includes(cmdId)) return true;
  }

  return false;
}
