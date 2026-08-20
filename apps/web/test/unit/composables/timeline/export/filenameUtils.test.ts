/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  getExt,
  sanitizeBaseName,
  normalizeExportFilename,
  hasInvalidExportFilenameChars,
  resolveNextAvailableFilename,
} from '~/composables/timeline/export/filenameUtils';

describe('getExt', () => {
  it('returns mp4 by default', () => {
    expect(getExt('mp4')).toBe('mp4');
  });

  it('returns webm for webm', () => {
    expect(getExt('webm')).toBe('webm');
  });

  it('returns mkv for mkv', () => {
    expect(getExt('mkv')).toBe('mkv');
  });

  it('returns aac for aac', () => {
    expect(getExt('aac')).toBe('aac');
  });

  it('returns opus for opus', () => {
    expect(getExt('opus')).toBe('opus');
  });

  it('returns wav for wav', () => {
    expect(getExt('wav')).toBe('wav');
  });

  it('returns mp3 for mp3', () => {
    expect(getExt('mp3')).toBe('mp3');
  });

  it('falls back to mp4 for an unknown format', () => {
    expect(getExt('unknown' as never)).toBe('mp4');
  });
});

describe('sanitizeBaseName', () => {
  it('removes file extension', () => {
    expect(sanitizeBaseName('video.mp4')).toBe('video');
  });

  it('replaces special characters with underscore', () => {
    expect(sanitizeBaseName('hello world!')).toBe('hello_world');
  });

  it('collapses multiple underscores', () => {
    expect(sanitizeBaseName('a   b')).toBe('a_b');
  });

  it('trims leading/trailing underscores', () => {
    expect(sanitizeBaseName('  hello  ')).toBe('hello');
  });

  it('returns untitled for empty string', () => {
    expect(sanitizeBaseName('')).toBe('untitled');
  });

  it('returns untitled for all-special-chars string', () => {
    expect(sanitizeBaseName('!!!???')).toBe('untitled');
  });

  it('appends underscore to reserved Windows names', () => {
    expect(sanitizeBaseName('CON')).toBe('CON_');
    expect(sanitizeBaseName('PRN')).toBe('PRN_');
    expect(sanitizeBaseName('NUL')).toBe('NUL_');
    expect(sanitizeBaseName('COM1')).toBe('COM1_');
    expect(sanitizeBaseName('LPT1')).toBe('LPT1_');
  });

  it('does not append underscore to non-reserved names', () => {
    expect(sanitizeBaseName('CONCERT')).toBe('CONCERT');
  });

  it('preserves unicode characters', () => {
    expect(sanitizeBaseName('видео')).toBe('видео');
  });
});

describe('normalizeExportFilename', () => {
  it('trims whitespace', () => {
    expect(normalizeExportFilename('  hello  ')).toBe('hello');
  });

  it('returns empty string for whitespace-only', () => {
    expect(normalizeExportFilename('   ')).toBe('');
  });
});

describe('hasInvalidExportFilenameChars', () => {
  it('returns false for valid filename', () => {
    expect(hasInvalidExportFilenameChars('my-video_01.mp4')).toBe(false);
  });

  it('returns true for angle brackets', () => {
    expect(hasInvalidExportFilenameChars('file<name>')).toBe(true);
  });

  it('returns true for quotes', () => {
    expect(hasInvalidExportFilenameChars('file"name')).toBe(true);
  });

  it('returns true for pipe', () => {
    expect(hasInvalidExportFilenameChars('file|name')).toBe(true);
  });

  it('returns true for question mark', () => {
    expect(hasInvalidExportFilenameChars('file?name')).toBe(true);
  });

  it('returns true for asterisk', () => {
    expect(hasInvalidExportFilenameChars('file*name')).toBe(true);
  });

  it('returns true for control characters', () => {
    expect(hasInvalidExportFilenameChars('file\x00name')).toBe(true);
  });

  it('returns true for backslash', () => {
    expect(hasInvalidExportFilenameChars('file\\name')).toBe(true);
  });

  it('returns true for forward slash', () => {
    expect(hasInvalidExportFilenameChars('nested/video.mp4')).toBe(true);
  });

  it('returns true for colon', () => {
    expect(hasInvalidExportFilenameChars('video:1.mp4')).toBe(true);
  });
});

describe('resolveNextAvailableFilename', () => {
  it('returns direct name when not in existing set', () => {
    const existing = new Set<string>(['other.mp4']);
    expect(resolveNextAvailableFilename(existing, 'video', 'mp4')).toBe('video.mp4');
  });

  it('returns indexed name when direct name exists', () => {
    const existing = new Set<string>(['video.mp4']);
    expect(resolveNextAvailableFilename(existing, 'video', 'mp4')).toBe('video_001.mp4');
  });

  it('increments index until available without filling gaps', () => {
    const existing = new Set<string>(['video.mp4', 'video_001.mp4', 'video_003.mp4']);
    expect(resolveNextAvailableFilename(existing, 'video', 'mp4')).toBe('video_004.mp4');
  });

  it('strips leading dot from extension', () => {
    const existing = new Set<string>();
    expect(resolveNextAvailableFilename(existing, 'video', '.mp4')).toBe('video.mp4');
  });

  it('lowercases extension', () => {
    const existing = new Set<string>();
    expect(resolveNextAvailableFilename(existing, 'video', 'MP4')).toBe('video.mp4');
  });

  it('sanitizes base name', () => {
    const existing = new Set<string>();
    expect(resolveNextAvailableFilename(existing, 'hello world!', 'mp4')).toBe('hello_world.mp4');
  });

  it('throws after 1000 attempts', () => {
    const existing = new Set<string>();
    existing.add('video.mp4');
    for (let i = 1; i <= 1000; i++) {
      existing.add(`video_${String(i).padStart(3, '0')}.mp4`);
    }
    expect(() => resolveNextAvailableFilename(existing, 'video', 'mp4')).toThrow();
  });
});
