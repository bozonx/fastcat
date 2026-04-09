import { describe, expect, it } from 'vitest';

import { isOpenableProjectFileName, isOpenableProjectTextFilename } from '~/utils/media-types';

describe('media-types', () => {
  it('treats known text formats as openable project text files', () => {
    expect(isOpenableProjectTextFilename('notes.md')).toBe(true);
    expect(isOpenableProjectTextFilename('scene.json')).toBe(true);
    expect(isOpenableProjectTextFilename('config.yaml')).toBe(true);
  });

  it('keeps binary files non-openable as text', () => {
    expect(isOpenableProjectTextFilename('clip.mp4')).toBe(false);
  });

  it('allows text files to open as project files', () => {
    expect(isOpenableProjectFileName('notes.txt')).toBe(true);
    expect(isOpenableProjectFileName('config.yml')).toBe(true);
  });
});
