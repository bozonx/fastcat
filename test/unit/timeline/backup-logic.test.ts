import { describe, it, expect } from 'vitest';
import { getBackupNumber, getNextBackupName, getBackupsToDelete } from '~/utils/timeline-backup';

describe('getBackupNumber', () => {
  it('parses a valid backup number', () => {
    expect(getBackupNumber('timeline__bak005.otio')).toBe(5);
    expect(getBackupNumber('timeline__bak123.otio')).toBe(123);
  });

  it('returns null for non-backup names', () => {
    expect(getBackupNumber('timeline.otio')).toBeNull();
    expect(getBackupNumber('timeline__bak01.otio')).toBeNull();
    expect(getBackupNumber('other.txt')).toBeNull();
  });
});

describe('getNextBackupName', () => {
  it('starts at 001 when no backups exist', () => {
    expect(getNextBackupName('timeline', [])).toBe('timeline__bak001.otio');
  });

  it('increments the highest existing number', () => {
    const existing = ['timeline__bak001.otio', 'timeline__bak003.otio'];
    expect(getNextBackupName('timeline', existing)).toBe('timeline__bak004.otio');
  });

  it('fills a gap when intermediate numbers are missing', () => {
    const existing = ['timeline__bak001.otio', 'timeline__bak005.otio'];
    expect(getNextBackupName('timeline', existing)).toBe('timeline__bak006.otio');
  });

  it('pads the number with leading zeros', () => {
    expect(getNextBackupName('cut', ['cut__bak099.otio'])).toBe('cut__bak100.otio');
  });
});

describe('getBackupsToDelete', () => {
  it('returns empty list when under the limit', () => {
    const existing = ['t__bak001.otio', 't__bak002.otio'];
    expect(getBackupsToDelete(existing, 5)).toEqual([]);
  });

  it('deletes the oldest backups to make room', () => {
    const existing = ['t__bak001.otio', 't__bak002.otio', 't__bak003.otio'];
    expect(getBackupsToDelete(existing, 2)).toEqual(['t__bak001.otio', 't__bak002.otio']);
  });

  it('deletes one backup when at exact limit', () => {
    const existing = ['t__bak001.otio', 't__bak002.otio'];
    expect(getBackupsToDelete(existing, 2)).toEqual(['t__bak001.otio']);
  });

  it('ignores non-backup names', () => {
    const existing = ['t__bak002.otio', 'other.txt', 't__bak001.otio'];
    expect(getBackupsToDelete(existing, 1)).toEqual(['t__bak001.otio', 't__bak002.otio']);
  });
});
