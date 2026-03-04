import { describe, it, expect } from 'vitest';
import { isTimelineTextDropFileName } from '../../../src/utils/timeline/textDrop';

describe('isTimelineTextDropFileName', () => {
  it('returns true for txt and md (case-insensitive)', () => {
    expect(isTimelineTextDropFileName('a.txt')).toBe(true);
    expect(isTimelineTextDropFileName('a.TXT')).toBe(true);
    expect(isTimelineTextDropFileName('a.md')).toBe(true);
    expect(isTimelineTextDropFileName('a.Md')).toBe(true);
  });

  it('returns false for other extensions', () => {
    expect(isTimelineTextDropFileName('a.json')).toBe(false);
    expect(isTimelineTextDropFileName('a.yaml')).toBe(false);
    expect(isTimelineTextDropFileName('a.mp4')).toBe(false);
    expect(isTimelineTextDropFileName('a')).toBe(false);
  });
});
