import {
  DEFAULT_HOTKEYS,
  type HotkeyCommandDefinition,
  type HotkeyCommandId,
  type HotkeyGroupId,
} from './defaultHotkeys';

function areGroupsOverlapping(a: HotkeyGroupId, b: HotkeyGroupId): boolean {
  if (a === b) return true;
  if (a === 'general' || b === 'general') return true;
  return false;
}

function getCommandGroupId(
  commands: readonly HotkeyCommandDefinition[],
  cmdId: HotkeyCommandId,
): HotkeyGroupId {
  return commands.find((c) => c.id === cmdId)?.groupId ?? 'general';
}

export interface HotkeyConflictsResult {
  conflictsByCommand: Map<HotkeyCommandId, Set<string>>;
}

export function getHotkeyConflicts(
  effective: Record<HotkeyCommandId, string[]>,
  commands: readonly HotkeyCommandDefinition[] = DEFAULT_HOTKEYS.commands,
): HotkeyConflictsResult {
  const conflictsByCommand = new Map<HotkeyCommandId, Set<string>>();

  const groupById = new Map<HotkeyCommandId, HotkeyGroupId>();
  for (const cmd of commands) {
    groupById.set(cmd.id, cmd.groupId);
  }

  for (const cmd of commands) {
    const list = effective[cmd.id] ?? [];
    if (list.length === 0) continue;

    const cmdGroup = groupById.get(cmd.id) ?? cmd.groupId;

    for (const combo of list) {
      let hasConflict = false;

      for (const other of commands) {
        if (other.id === cmd.id) continue;

        const otherGroup = groupById.get(other.id) ?? other.groupId;
        if (!areGroupsOverlapping(cmdGroup, otherGroup)) continue;

        const otherList = effective[other.id] ?? [];
        if (otherList.includes(combo)) {
          hasConflict = true;
          break;
        }
      }

      if (!hasConflict) continue;

      const set = conflictsByCommand.get(cmd.id) ?? new Set<string>();
      set.add(combo);
      conflictsByCommand.set(cmd.id, set);
    }
  }

  return { conflictsByCommand };
}

export function isHotkeyConflicting(
  params: {
    conflicts: HotkeyConflictsResult;
    cmdId: HotkeyCommandId;
    combo: string;
  },
): boolean {
  return params.conflicts.conflictsByCommand.get(params.cmdId)?.has(params.combo) ?? false;
}

export function findDuplicateOwnerByContext(
  params: {
    effective: Record<HotkeyCommandId, string[]>;
    commands: readonly HotkeyCommandDefinition[];
    targetCmdId: HotkeyCommandId;
    combo: string;
  },
): HotkeyCommandId | null {
  const { effective, commands, targetCmdId, combo } = params;
  const targetGroupId = getCommandGroupId(commands, targetCmdId);

  for (const cmd of commands) {
    if (cmd.id === targetCmdId) continue;

    if (!areGroupsOverlapping(targetGroupId, cmd.groupId)) continue;

    const bindings = effective[cmd.id] ?? [];
    if (bindings.includes(combo)) return cmd.id;
  }

  return null;
}
