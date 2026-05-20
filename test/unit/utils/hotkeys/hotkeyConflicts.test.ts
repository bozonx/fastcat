/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getHotkeyConflicts,
  isHotkeyConflicting,
  findDuplicateOwnerByContext,
} from '~/utils/hotkeys/hotkeyConflicts';

const mockCommands = [
  { id: 'play', groupId: 'general', label: 'Play' },
  { id: 'pause', groupId: 'general', label: 'Pause' },
  { id: 'cut', groupId: 'timeline', label: 'Cut' },
  { id: 'copy', groupId: 'timeline', label: 'Copy' },
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
