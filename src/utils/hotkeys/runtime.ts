import type { AnyPanelFocus } from '~/stores/focus.store';
import type { HotkeyCommandId, HotkeyCombo } from './defaultHotkeys';
import { DEFAULT_HOTKEYS } from './defaultHotkeys';
import { hotkeyFromKeyboardEvent } from './hotkeyUtils';
import { getEffectiveHotkeyBindings } from './effectiveHotkeys';
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
  'general.fullscreen': {
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
      if (!lookup[combo]) {
        lookup[combo] = [];
      }
      lookup[combo]!.push(cmdId);
    }
  }

  return lookup as HotkeyLookup;
}

export function getFocusAwareHotkeyOrder(params: {
  matched: HotkeyCommandId[];
  canUseTimelineHotkeys: boolean;
  canUsePlaybackHotkeys: boolean;
}): HotkeyCommandId[] {
  const { matched, canUseTimelineHotkeys, canUsePlaybackHotkeys } = params;

  const timeline = matched.filter((c) => c.startsWith('timeline.'));
  const playback = matched.filter((c) => c.startsWith('playback.'));
  const general = matched.filter((c) => c.startsWith('general.'));

  if (canUseTimelineHotkeys) {
    return [...timeline, ...general, ...playback];
  }

  if (canUsePlaybackHotkeys) {
    return [...playback, ...general, ...timeline];
  }

  return [...general, ...timeline, ...playback];
}

export function canExecuteHotkeyCommand(params: {
  cmdId: HotkeyCommandId;
  hasBlockingModalState: boolean;
  isEditableEventTarget: boolean;
  isEditableActiveElement: boolean;
}): boolean {
  const { cmdId, hasBlockingModalState, isEditableEventTarget, isEditableActiveElement } = params;
  const policy = getHotkeyCommandPolicy(cmdId);

  if (hasBlockingModalState && !policy.allowWhenModalOpen) {
    return false;
  }

  if (!policy.allowInEditable && (isEditableEventTarget || isEditableActiveElement)) {
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
  isEditableTarget: (target: EventTarget | null) => boolean;
}): boolean {
  const { cmdId, activeElement, isEditableTarget } = params;
  const policy = getHotkeyCommandPolicy(cmdId);

  if (!policy.blurActiveElementOnExecute) {
    return false;
  }

  return activeElement instanceof HTMLElement && !isEditableTarget(activeElement);
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
  return (
    focusId === 'left' ||
    focusId === 'right' ||
    focusId === 'project' ||
    String(focusId).startsWith('dynamic:')
  );
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
