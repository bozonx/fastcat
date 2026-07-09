import type { HotkeyGroupId } from './defaultHotkeys';

const GLOBAL_HOTKEY_GROUPS: ReadonlySet<HotkeyGroupId> = new Set([
  'general',
  'timelineMonitorGlobal',
]);

export function isGlobalHotkeyGroup(groupId: HotkeyGroupId): boolean {
  return GLOBAL_HOTKEY_GROUPS.has(groupId);
}

export function getHotkeyConflictScope(groupId: HotkeyGroupId): string {
  return isGlobalHotkeyGroup(groupId) ? 'global' : groupId;
}

export function getHotkeyPriorityLevel(groupId: HotkeyGroupId): 'global' | 'local' {
  return isGlobalHotkeyGroup(groupId) ? 'global' : 'local';
}

export function areHotkeyGroupsOverlapping(a: HotkeyGroupId, b: HotkeyGroupId): boolean {
  return getHotkeyConflictScope(a) === getHotkeyConflictScope(b);
}

export function areHotkeyGroupsOverrideable(a: HotkeyGroupId, b: HotkeyGroupId): boolean {
  return getHotkeyPriorityLevel(a) !== getHotkeyPriorityLevel(b);
}
