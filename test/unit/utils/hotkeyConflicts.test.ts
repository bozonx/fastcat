/** @vitest-environment node */
import { describe, expect, it } from 'vitest';

import {
  getHotkeyConflicts,
  getHotkeyOverrides,
  isHotkeyConflicting,
  isHotkeyOverriding,
  findDuplicateOwnerByContext,
  findOverrideOwnerByContext,
} from '~/utils/hotkeys/hotkeyConflicts';

import type { HotkeyCommandDefinition, HotkeyCommandId } from '~/utils/hotkeys/defaultHotkeys';

const commands: readonly HotkeyCommandDefinition[] = [
  { id: 'general.focus', groupId: 'general', title: 'Focus' },
  { id: 'general.navigateBack', groupId: 'fileManager', title: 'Navigate back' },
  { id: 'general.navigateUp', groupId: 'fileManager', title: 'Navigate up' },
  { id: 'timeline.splitAtPlayhead', groupId: 'timeline', title: 'Split' },
  { id: 'timeline.rippleDelete', groupId: 'timeline', title: 'Ripple delete' },
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

  it('does not treat same combo in general and timeline as conflict', () => {
    const effective = makeEffective({
      'general.focus': ['Space'],
      'timeline.splitAtPlayhead': ['Space'],
    });

    const conflicts = getHotkeyConflicts(effective, commands);

    expect(isHotkeyConflicting({ conflicts, cmdId: 'general.focus', combo: 'Space' })).toBe(false);
    expect(
      isHotkeyConflicting({ conflicts, cmdId: 'timeline.splitAtPlayhead', combo: 'Space' }),
    ).toBe(false);
  });

  it('does not treat same combo in file manager and timeline as conflict', () => {
    const effective = makeEffective({
      'general.navigateBack': ['Backspace'],
      'timeline.rippleDelete': ['Backspace'],
    });

    const conflicts = getHotkeyConflicts(effective, commands);

    expect(
      isHotkeyConflicting({ conflicts, cmdId: 'general.navigateBack', combo: 'Backspace' }),
    ).toBe(false);
    expect(
      isHotkeyConflicting({ conflicts, cmdId: 'timeline.rippleDelete', combo: 'Backspace' }),
    ).toBe(false);
  });

  it('treats same combo inside file manager as conflict', () => {
    const effective = makeEffective({
      'general.navigateBack': ['Backspace'],
      'general.navigateUp': ['Backspace'],
    });

    const conflicts = getHotkeyConflicts(effective, commands);

    expect(
      isHotkeyConflicting({ conflicts, cmdId: 'general.navigateBack', combo: 'Backspace' }),
    ).toBe(true);
    expect(
      isHotkeyConflicting({ conflicts, cmdId: 'general.navigateUp', combo: 'Backspace' }),
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

  it('findDuplicateOwnerByContext ignores general vs timeline duplicates', () => {
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
    ).toBeNull();
  });

  it('findDuplicateOwnerByContext ignores file manager vs timeline duplicates', () => {
    const effective = makeEffective({
      'general.navigateBack': ['Backspace'],
      'timeline.rippleDelete': ['Backspace'],
    });

    expect(
      findDuplicateOwnerByContext({
        effective,
        commands,
        targetCmdId: 'timeline.rippleDelete',
        combo: 'Backspace',
      }),
    ).toBeNull();
  });

  it('findOverrideOwnerByContext detects general vs timeline override', () => {
    const effective = makeEffective({
      'general.focus': ['Space'],
      'timeline.splitAtPlayhead': ['Space'],
    });

    expect(
      findOverrideOwnerByContext({
        effective,
        commands,
        targetCmdId: 'timeline.splitAtPlayhead',
        combo: 'Space',
      }),
    ).toBe('general.focus');
  });

  it('getHotkeyOverrides detects cross-group overlaps', () => {
    const effective = makeEffective({
      'general.focus': ['Space'],
      'timeline.splitAtPlayhead': ['Space'],
    });

    const overrides = getHotkeyOverrides(effective, commands);
    expect(isHotkeyOverriding({ overrides, cmdId: 'general.focus', combo: 'Space' })).toBe(true);
    expect(
      isHotkeyOverriding({ overrides, cmdId: 'timeline.splitAtPlayhead', combo: 'Space' }),
    ).toBe(true);
  });
});
