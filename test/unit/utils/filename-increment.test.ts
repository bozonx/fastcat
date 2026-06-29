import { describe, it, expect } from 'vitest';
import { parseFilename, getNextIncrementName } from '~/utils/filename-increment';

describe('parseFilename', () => {
  it('parses parentheses style counter', () => {
    expect(parseFilename('video (3).mp4')).toEqual({
      base: 'video',
      suffixStyle: 'parentheses',
      counter: 3,
      padWidth: 1,
      ext: '.mp4',
    });
    expect(parseFilename('video (007).mp4')).toEqual({
      base: 'video',
      suffixStyle: 'parentheses',
      counter: 7,
      padWidth: 3,
      ext: '.mp4',
    });
  });

  it('parses underscore style counter', () => {
    expect(parseFilename('clip_012.mp4')).toEqual({
      base: 'clip',
      suffixStyle: 'underscore',
      counter: 12,
      padWidth: 3,
      ext: '.mp4',
    });
  });

  it('parses space style counter', () => {
    expect(parseFilename('document 05.md')).toEqual({
      base: 'document',
      suffixStyle: 'space',
      counter: 5,
      padWidth: 2,
      ext: '.md',
    });
  });

  it('parses none style counter (digits directly attached)', () => {
    expect(parseFilename('timeline003.otio')).toEqual({
      base: 'timeline',
      suffixStyle: 'none',
      counter: 3,
      padWidth: 3,
      ext: '.otio',
    });
  });

  it('returns null counter if no suffix style matched', () => {
    expect(parseFilename('video.mp4')).toEqual({
      base: 'video',
      suffixStyle: null,
      counter: null,
      padWidth: 0,
      ext: '.mp4',
    });
  });
});

describe('getNextIncrementName', () => {
  it('returns original name if not in existingNames and forceIndex is false', () => {
    const res = getNextIncrementName({
      fileName: 'video.mp4',
      existingNames: ['other.mp4'],
    });
    expect(res).toBe('video.mp4');
  });

  it('increments based on the maximum counter value, ignoring gaps', () => {
    const res1 = getNextIncrementName({
      fileName: 'video.mp4',
      existingNames: ['video.mp4', 'video_001.mp4', 'video_003.mp4'],
      style: 'underscore',
      padWidth: 3,
    });
    expect(res1).toBe('video_004.mp4');

    const res2 = getNextIncrementName({
      fileName: 'video_001.mp4',
      existingNames: ['video_001.mp4', 'video_003.mp4'],
    });
    expect(res2).toBe('video_004.mp4');
  });

  it('respects different styles', () => {
    const resParen = getNextIncrementName({
      fileName: 'video.mp4',
      existingNames: ['video.mp4', 'video (2).mp4'],
      style: 'parentheses',
      padWidth: 1,
    });
    expect(resParen).toBe('video (3).mp4');

    const resSpace = getNextIncrementName({
      fileName: 'doc.txt',
      existingNames: ['doc.txt', 'doc 01.txt', 'doc 03.txt'],
      style: 'space',
      padWidth: 2,
    });
    expect(resSpace).toBe('doc 04.txt');
  });

  it('respects forceIndex option', () => {
    const res = getNextIncrementName({
      fileName: 'video.mp4',
      existingNames: [],
      style: 'underscore',
      padWidth: 3,
      forceIndex: true,
    });
    expect(res).toBe('video_001.mp4');
  });

  it('respects startIndex option', () => {
    const res = getNextIncrementName({
      fileName: 'video.mp4',
      existingNames: ['video.mp4'],
      style: 'underscore',
      padWidth: 3,
      startIndex: 5,
    });
    expect(res).toBe('video_005.mp4');
  });
});
