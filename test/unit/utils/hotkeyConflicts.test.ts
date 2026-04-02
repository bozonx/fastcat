/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import {
  getHotkeyConflicts,
  isHotkeyConflicting,
  findDuplicateOwnerByContext,
} from '~/utils/hotkeys/hotkeyConflicts';

import type { HotkeyCommandDefinition, HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';

const commands: readonly HotkeyCommandDefinition[] = [
  { id: 'general.focus', groupId: 'general', title: 'Focus' },
  { id: 'timeline.splitAtPlayhead', groupId: 'timeline', title: 'Split' },
  { id: 'playback.toggle', groupId: 'playback', title: 'Play/Pause' },
];

function makeEffective(bindings: Partial<Record<HotkeyCommandId, string[]>>) {
  return bindings as Record<HotkeyCommandId, string[]>;
}

describe('hotkeyConflicts', () => {
  it('does not treat same combo in timeline and playback as conflict', () => {
    const effective = makeEffective({
      'timeline.splitAtPlayhead': ['Space'],
      'playback.toggle': ['Space'],
    });

    const conflicts = getHotkeyConflicts(effective, commands);

    expect(
      isHotkeyConflicting({ conflicts, cmdId: 'timeline.splitAtPlayhead', combo: 'Space' }),
    ).toBe(false);
    expect(isHotkeyConflicting({ conflicts, cmdId: 'playback.toggle', combo: 'Space' })).toBe(
      false,
    );
  });

  it('treats same combo in general and timeline as conflict (general is global)', () => {
    const effective = makeEffective({
      'general.focus': ['Space'],
      'timeline.splitAtPlayhead': ['Space'],
    });

    const conflicts = getHotkeyConflicts(effective, commands);

    expect(isHotkeyConflicting({ conflicts, cmdId: 'general.focus', combo: 'Space' })).toBe(true);
    expect(
      isHotkeyConflicting({ conflicts, cmdId: 'timeline.splitAtPlayhead', combo: 'Space' }),
    ).toBe(true);
  });

  it('findDuplicateOwnerByContext ignores timeline vs playback duplicates', () => {
    const effective = makeEffective({
      'timeline.splitAtPlayhead': ['Space'],
      'playback.toggle': ['Space'],
    });

    expect(
      findDuplicateOwnerByContext({
        effective,
        commands,
        targetCmdId: 'timeline.splitAtPlayhead',
        combo: 'Space',
      }),
    ).toBeNull();

    expect(
      findDuplicateOwnerByContext({
        effective,
        commands,
        targetCmdId: 'playback.toggle',
        combo: 'Space',
      }),
    ).toBeNull();
  });

  it('findDuplicateOwnerByContext treats general as duplicate owner across contexts', () => {
    const effective = makeEffective({
      'general.focus': ['Space'],
      'timeline.splitAtPlayhead': ['Space'],
    });

    expect(
      findDuplicateOwnerByContext({
        effective,
        commands,
        targetCmdId: 'timeline.splitAtPlayhead',
        combo: 'Space',
      }),
    ).toBe('general.focus');
  });
});
