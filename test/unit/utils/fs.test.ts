/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { generateUniqueFsEntryName } from '~/utils/fs';

describe('generateUniqueFsEntryName', () => {
  it('finds first unique name using existingNames', async () => {
    const result = await generateUniqueFsEntryName({
      vfs: {} as any,
      dirPath: '',
      baseName: 'test',
      extension: '.mp4',
      existingNames: ['test001.mp4'],
    });
    expect(result).toBe('test002.mp4');
  });

  it('returns first candidate when no conflicts', async () => {
    const result = await generateUniqueFsEntryName({
      vfs: {} as any,
      dirPath: '',
      baseName: 'clip',
      extension: '.mov',
      existingNames: [],
    });
    expect(result).toBe('clip001.mov');
  });

  it('respects custom startIndex and padWidth', async () => {
    const result = await generateUniqueFsEntryName({
      vfs: {} as any,
      dirPath: '',
      baseName: 'file',
      extension: '.txt',
      existingNames: ['file05.txt', 'file06.txt'],
      startIndex: 5,
      padWidth: 2,
    });
    expect(result).toBe('file07.txt');
  });

  it('finds first gap in existingNames', async () => {
    const result = await generateUniqueFsEntryName({
      vfs: {} as any,
      dirPath: '',
      baseName: 'item',
      extension: '.json',
      existingNames: ['item001.json', 'item003.json'],
    });
    expect(result).toBe('item002.json');
  });
});
