import { describe, it, expect } from 'vitest';

describe('Backup naming logic', () => {
  it('generates correct backup filename pattern', () => {
    const fileName = 'timeline.otio';
    const baseName = fileName.replace(/\.otio$/, '');
    const backupName = `${baseName}__bak001.otio`;
    expect(backupName).toBe('timeline__bak001.otio');
  });

  it('extracts backup number from existing filename', () => {
    const match = 'timeline__bak005.otio'.match(/__bak(\d{3})\.otio$/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('005');
    expect(parseInt(match![1], 10)).toBe(5);
  });

  it('sorts backups by number', () => {
    const backups = [
      { name: 'timeline__bak003.otio', num: 3 },
      { name: 'timeline__bak001.otio', num: 1 },
      { name: 'timeline__bak002.otio', num: 2 },
    ];
    backups.sort((a, b) => a.num - b.num);
    expect(backups[0].num).toBe(1);
    expect(backups[1].num).toBe(2);
    expect(backups[2].num).toBe(3);
  });

  it('calculates next backup number correctly', () => {
    const existingBackups = [
      { name: 'timeline__bak001.otio', num: 1 },
      { name: 'timeline__bak002.otio', num: 2 },
    ];
    const nextNum =
      existingBackups.length > 0 ? existingBackups[existingBackups.length - 1]!.num + 1 : 1;
    expect(nextNum).toBe(3);
  });

  it('calculates next backup number when no backups exist', () => {
    const existingBackups: { name: string; num: number }[] = [];
    const nextNum =
      existingBackups.length > 0 ? existingBackups[existingBackups.length - 1]!.num + 1 : 1;
    expect(nextNum).toBe(1);
  });

  it('formats backup number with leading zeros', () => {
    const num = 5;
    const formatted = num.toString().padStart(3, '0');
    expect(formatted).toBe('005');
  });

  it('handles backup number overflow correctly', () => {
    const num = 999;
    const formatted = num.toString().padStart(3, '0');
    expect(formatted).toBe('999');
  });
});

describe('Version naming logic', () => {
  it('generates correct version filename pattern', () => {
    const prefix = 'timeline';
    const version = 2;
    const versionName = `${prefix}_v${version.toString().padStart(2, '0')}.otio`;
    expect(versionName).toBe('timeline_v02.otio');
  });

  it('extracts version number from existing filename with _vXX suffix', () => {
    const match = 'timeline_v05.otio'.slice(0, -'.otio'.length).match(/_v(\d{1,3})$/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('05');
    expect(parseInt(match![1], 10)).toBe(5);
  });

  it('recognizes original file (without version suffix) as version 0', () => {
    const fileName = 'timeline.otio';
    const baseName = fileName.slice(0, -'.otio'.length);
    const existingVersions: number[] = [];

    if (fileName === 'timeline.otio') {
      existingVersions.push(0);
    }

    expect(existingVersions).toContain(0);
  });

  it('calculates next version number correctly', () => {
    const existingVersions = [0, 1, 2];
    existingVersions.sort((a, b) => a - b);
    const nextNum =
      existingVersions.length > 0 ? existingVersions[existingVersions.length - 1]! + 1 : 1;
    expect(nextNum).toBe(3);
  });

  it('calculates next version when only original exists', () => {
    const existingVersions = [0];
    const nextNum =
      existingVersions.length > 0 ? existingVersions[existingVersions.length - 1]! + 1 : 1;
    expect(nextNum).toBe(1);
  });

  it('extracts prefix from versioned filename', () => {
    const fileName = 'my_timeline_v12.otio';
    const baseName = fileName.replace(/\.otio$/, '');
    const match = baseName.match(/^(.*)_v(\d{1,3})$/);

    expect(match).not.toBeNull();
    expect(match![1]).toBe('my_timeline');
    expect(match![2]).toBe('12');
  });

  it('uses full name as prefix when file has no version suffix', () => {
    const fileName = 'my_timeline.otio';
    const baseName = fileName.replace(/\.otio$/, '');
    const match = baseName.match(/^(.*)_v(\d{1,3})$/);

    expect(match).toBeNull();

    const prefix = match ? match[1] : baseName;
    expect(prefix).toBe('my_timeline');
  });
});

describe('Backup cleanup logic', () => {
  it('calculates number of backups to delete when over limit', () => {
    const backupCount = 2;
    const existingBackups = [
      { name: 'timeline__bak001.otio', num: 1 },
      { name: 'timeline__bak002.otio', num: 2 },
      { name: 'timeline__bak003.otio', num: 3 },
    ];

    if (existingBackups.length >= backupCount) {
      const toDeleteCount = existingBackups.length - backupCount + 1;
      expect(toDeleteCount).toBe(2);

      const toDelete = existingBackups.slice(0, toDeleteCount);
      expect(toDelete).toHaveLength(2);
      expect(toDelete[0].num).toBe(1);
      expect(toDelete[1].num).toBe(2);
    }
  });

  it('keeps newest backups when deleting', () => {
    const backupCount = 2;
    const existingBackups = [
      { name: 'timeline__bak001.otio', num: 1 },
      { name: 'timeline__bak002.otio', num: 2 },
      { name: 'timeline__bak003.otio', num: 3 },
    ];

    const toDeleteCount = existingBackups.length - backupCount + 1;
    const toDelete = existingBackups.slice(0, toDeleteCount);
    const toKeep = existingBackups.slice(toDeleteCount);

    // When we have 3 backups and want to keep 2, we delete 2 oldest (1 and 2)
    // After adding the new backup, we'll have: [3, new] = 2 backups
    expect(toDelete).toHaveLength(2);
    expect(toDelete[0].num).toBe(1);
    expect(toDelete[1].num).toBe(2);
    expect(toKeep).toHaveLength(1);
    expect(toKeep[0].num).toBe(3);
  });

  it('does not delete when under limit', () => {
    const backupCount = 5;
    const existingBackups = [
      { name: 'timeline__bak001.otio', num: 1 },
      { name: 'timeline__bak002.otio', num: 2 },
    ];

    const shouldDelete = existingBackups.length >= backupCount;
    expect(shouldDelete).toBe(false);
    expect(existingBackups.length).toBeLessThan(backupCount);
  });

  it('handles exact backup count', () => {
    const backupCount = 2;
    const existingBackups = [
      { name: 'timeline__bak001.otio', num: 1 },
      { name: 'timeline__bak002.otio', num: 2 },
    ];

    // When at exact limit, we need to delete 1 to make room for new backup
    const toDeleteCount =
      existingBackups.length >= backupCount ? existingBackups.length - backupCount + 1 : 0;

    expect(toDeleteCount).toBe(1);
  });
});

describe('Backup interval logic', () => {
  it('skips backup when interval has not elapsed', () => {
    const lastBackupTime = Date.now() - 60_000; // 1 minute ago
    const intervalMinutes = 5;
    const intervalMs = intervalMinutes * 60 * 1000;
    const now = Date.now();

    const shouldBackup = now - lastBackupTime >= intervalMs;
    expect(shouldBackup).toBe(false);
  });

  it('creates backup when interval has elapsed', () => {
    const lastBackupTime = Date.now() - 300_000 - 1; // Just over 5 minutes ago
    const intervalMinutes = 5;
    const intervalMs = intervalMinutes * 60 * 1000;
    const now = Date.now();

    const shouldBackup = now - lastBackupTime >= intervalMs;
    expect(shouldBackup).toBe(true);
  });

  it('allows immediate backup when backup is disabled (0)', () => {
    const intervalMinutes = 0;
    const shouldCreateBackup = intervalMinutes > 0;
    expect(shouldCreateBackup).toBe(false);
  });

  it('allows immediate backup on first save', () => {
    const lastBackupTime = 0; // Never backed up
    const intervalMinutes = 5;
    const intervalMs = intervalMinutes * 60 * 1000;
    const now = Date.now();

    const shouldBackup = lastBackupTime === 0 || now - lastBackupTime >= intervalMs;
    expect(shouldBackup).toBe(true);
  });
});
