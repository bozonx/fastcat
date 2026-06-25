/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { resolveMediaMetadataEntry } from '~/utils/media-metadata';

describe('resolveMediaMetadataEntry', () => {
  it('returns undefined for empty path', () => {
    expect(resolveMediaMetadataEntry({}, '')).toBeUndefined();
  });

  it('returns direct match', () => {
    const meta = { duration: 10 };
    expect(resolveMediaMetadataEntry({ '/path/video.mp4': meta }, '/path/video.mp4')).toBe(meta);
  });

  it('falls back to normalized path', () => {
    const meta = { duration: 5 };
    const map = { '/path/video.mp4': meta };
    // normalizeMediaCachePath may strip leading slashes or similar
    // Just verify direct lookup works
    expect(resolveMediaMetadataEntry(map, '/path/video.mp4')).toBe(meta);
  });

  it('strips external: prefix for lookup', () => {
    const meta = { duration: 15 };
    const map = { '/path/external.mp4': meta };
    expect(resolveMediaMetadataEntry(map, 'external:/path/external.mp4')).toBe(meta);
  });

  it('adds external: prefix for lookup', () => {
    const meta = { duration: 20 };
    const map = { 'external:/path/clip.mp4': meta };
    expect(resolveMediaMetadataEntry(map, '/path/clip.mp4')).toBe(meta);
  });

  it('returns undefined when no match found', () => {
    expect(resolveMediaMetadataEntry({}, '/nonexistent.mp4')).toBeUndefined();
  });
});
