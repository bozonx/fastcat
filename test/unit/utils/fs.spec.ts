/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { generateUniqueFsEntryName } from '~/utils/fs';
import { InMemoryFileSystemAdapter } from '~/file-manager/core/vfs/adapters/InMemoryFileSystemAdapter';

describe('fs utils', () => {
  let vfs: InMemoryFileSystemAdapter;

  beforeEach(() => {
    vfs = new InMemoryFileSystemAdapter();
  });

  describe('generateUniqueFsEntryName', () => {
    it('generates name based on existingNames array', async () => {
      const name = await generateUniqueFsEntryName({
        vfs,
        dirPath: '',
        baseName: 'Project_',
        extension: '.json',
        existingNames: ['Project_001.json', 'Project_002.json'],
      });
      expect(name).toBe('Project_003.json');
    });

    it('generates name by checking vfs if existingNames not provided', async () => {
      await vfs.writeFile('Project_001.json', '{}');
      await vfs.writeFile('Project_002.json', '{}');

      const name = await generateUniqueFsEntryName({
        vfs,
        dirPath: '',
        baseName: 'Project_',
        extension: '.json',
      });
      expect(name).toBe('Project_003.json');
    });

    it('generates name by checking vfs inside directory', async () => {
      await vfs.createDirectory('projects');
      await vfs.writeFile('projects/File_001.txt', '');

      const name = await generateUniqueFsEntryName({
        vfs,
        dirPath: 'projects',
        baseName: 'File_',
        extension: '.txt',
      });
      expect(name).toBe('File_002.txt');
    });
  });
});
