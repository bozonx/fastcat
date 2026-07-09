/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getHotkeyOverrides,
  getHotkeyConflicts,
  isHotkeyConflicting,
  isHotkeyOverriding,
  findDuplicateOwnerByContext,
  findOverrideOwnerByContext,
} from '~/utils/hotkeys/hotkeyConflicts';

const mockCommands = [
  { id: 'play', groupId: 'general', label: 'Play' },
  { id: 'pause', groupId: 'general', label: 'Pause' },
  { id: 'mute', groupId: 'timelineMonitorGlobal', label: 'Mute' },
  { id: 'cut', groupId: 'timeline', label: 'Cut' },
  { id: 'copy', groupId: 'timeline', label: 'Copy' },
  { id: 'step', groupId: 'monitor', label: 'Step' },
  { id: 'rename', groupId: 'fileManager', label: 'Rename' },
] as any;

describe('getHotkeyConflicts', () => {
  it('finds conflicts within overlapping groups', () => {
    const effective = {
      play: ['Space'],
      pause: ['Space'],
      cut: ['Ctrl+X'],
      copy: ['Ctrl+X'],
    };
    const result = getHotkeyConflicts(effective, mockCommands);
    expect(result.conflictsByCommand.get('play')).toEqual(new Set(['Space']));
    expect(result.conflictsByCommand.get('pause')).toEqual(new Set(['Space']));
    expect(result.conflictsByCommand.get('cut')).toEqual(new Set(['Ctrl+X']));
    expect(result.conflictsByCommand.get('copy')).toEqual(new Set(['Ctrl+X']));
  });

  it('treats general and timeline-monitor global as one conflict level', () => {
    const effective = {
      play: ['Space'],
      mute: ['Space'],
    };
    const result = getHotkeyConflicts(effective, mockCommands);
    expect(result.conflictsByCommand.get('play')).toEqual(new Set(['Space']));
    expect(result.conflictsByCommand.get('mute')).toEqual(new Set(['Space']));
  });

  it('does not conflict between global and local groups', () => {
    const effective = {
      play: ['Space'],
      cut: ['Space'],
    };
    const result = getHotkeyConflicts(effective, mockCommands);
    expect(result.conflictsByCommand.size).toBe(0);
  });

  it('does not conflict between different local groups', () => {
    const effective = {
      cut: ['Space'],
      step: ['Space'],
      rename: ['Space'],
    };
    const result = getHotkeyConflicts(effective, mockCommands);
    expect(result.conflictsByCommand.size).toBe(0);
  });

  it('returns empty when no conflicts', () => {
    const effective = {
      play: ['Space'],
      pause: ['Enter'],
    };
    const result = getHotkeyConflicts(effective, mockCommands);
    expect(result.conflictsByCommand.size).toBe(0);
  });

  it('ignores empty bindings', () => {
    const effective = {
      play: [],
      pause: ['Space'],
    };
    const result = getHotkeyConflicts(effective, mockCommands);
    expect(result.conflictsByCommand.size).toBe(0);
  });
});

describe('isHotkeyConflicting', () => {
  it('returns true for conflicting combo', () => {
    const conflicts = { conflictsByCommand: new Map([['play', new Set(['Space'])]]) };
    expect(
      isHotkeyConflicting({ conflicts: conflicts as any, cmdId: 'play', combo: 'Space' }),
    ).toBe(true);
  });

  it('returns false for non-conflicting combo', () => {
    const conflicts = { conflictsByCommand: new Map() };
    expect(
      isHotkeyConflicting({ conflicts: conflicts as any, cmdId: 'play', combo: 'Space' }),
    ).toBe(false);
  });
});

describe('findDuplicateOwnerByContext', () => {
  it('finds duplicate owner in same group', () => {
    const effective = {
      play: ['Space'],
      pause: ['Space'],
    };
    const result = findDuplicateOwnerByContext({
      effective,
      commands: mockCommands,
      targetCmdId: 'play',
      combo: 'Space',
    });
    expect(result).toBe('pause');
  });

  it('finds duplicate owner across the shared global level', () => {
    const effective = {
      play: ['Space'],
      mute: ['Space'],
    };
    const result = findDuplicateOwnerByContext({
      effective,
      commands: mockCommands,
      targetCmdId: 'play',
      combo: 'Space',
    });
    expect(result).toBe('mute');
  });

  it('ignores global vs local duplicates', () => {
    const effective = {
      play: ['Space'],
      cut: ['Space'],
    };
    const result = findDuplicateOwnerByContext({
      effective,
      commands: mockCommands,
      targetCmdId: 'cut',
      combo: 'Space',
    });
    expect(result).toBeNull();
  });

  it('returns null when no duplicate', () => {
    const effective = {
      play: ['Space'],
      pause: ['Enter'],
    };
    const result = findDuplicateOwnerByContext({
      effective,
      commands: mockCommands,
      targetCmdId: 'play',
      combo: 'Space',
    });
    expect(result).toBeNull();
  });
});

describe('hotkey overrides', () => {
  it('detects global to local remapping as override', () => {
    const effective = {
      play: ['Space'],
      cut: ['Space'],
    };
    const overrides = getHotkeyOverrides(effective, mockCommands);
    expect(isHotkeyOverriding({ overrides, cmdId: 'play', combo: 'Space' })).toBe(true);
    expect(isHotkeyOverriding({ overrides, cmdId: 'cut', combo: 'Space' })).toBe(true);
  });

  it('does not treat different local groups as overrides', () => {
    const effective = {
      cut: ['Space'],
      step: ['Space'],
    };
    const overrides = getHotkeyOverrides(effective, mockCommands);
    expect(overrides.overridesByCommand.size).toBe(0);
  });

  it('does not treat commands inside shared global level as overrides', () => {
    const effective = {
      play: ['Space'],
      mute: ['Space'],
    };
    const overrides = getHotkeyOverrides(effective, mockCommands);
    expect(overrides.overridesByCommand.size).toBe(0);
  });

  it('finds override owner only between global and local levels', () => {
    const effective = {
      play: ['Space'],
      cut: ['Space'],
      step: ['Space'],
    };

    expect(
      findOverrideOwnerByContext({
        effective,
        commands: mockCommands,
        targetCmdId: 'cut',
        combo: 'Space',
      }),
    ).toBe('play');

    expect(
      findOverrideOwnerByContext({
        effective,
        commands: mockCommands,
        targetCmdId: 'step',
        combo: 'Space',
      }),
    ).toBe('play');
  });
});
