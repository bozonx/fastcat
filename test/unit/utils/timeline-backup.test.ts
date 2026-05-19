/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getBackupNumber,
  getNextBackupName,
  getBackupsToDelete,
} from '~/utils/timeline-backup';

describe('timeline-backup', () => {
  it('extracts backup number from filename', () => {
    expect(getBackupNumber('timeline__bak001.otio')).toBe(1);
    expect(getBackupNumber('timeline__bak042.otio')).toBe(42);
    expect(getBackupNumber('timeline.otio')).toBeNull();
  });

  it('generates next backup name', () => {
    const next = getNextBackupName('timeline', [
      'timeline__bak001.otio',
      'timeline__bak003.otio',
    ]);
    expect(next).toBe('timeline__bak004.otio');
  });

  it('returns empty array when backups are below max count', () => {
    const toDelete = getBackupsToDelete(
      ['timeline__bak001.otio', 'timeline__bak002.otio'],
      5,
    );
    expect(toDelete).toEqual([]);
  });

  it('returns oldest backups to delete when over max count', () => {
    const toDelete = getBackupsToDelete(
      ['timeline__bak001.otio', 'timeline__bak002.otio', 'timeline__bak003.otio'],
      2,
    );
    expect(toDelete).toEqual(['timeline__bak001.otio', 'timeline__bak002.otio']);
  });
});
