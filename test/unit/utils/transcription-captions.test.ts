import { describe, it, expect } from 'vitest';
import {
  buildCaptionChunks,
  buildCaptionChunksFromWords,
  createDefaultCaptionGenerationSettings,
} from '../../../src/utils/transcription/captions';
import type { TranscriptionCacheRecord } from '../../../src/repositories/transcription-cache.repository';

function createRecord(
  words: Array<{ start: number; end: number; text: string }>,
): TranscriptionCacheRecord {
  return {
    key: 'cache-key',
    createdAt: '2026-03-07T00:00:00.000Z',
    sourcePath: '_video/test1.mp4',
    sourceName: 'test1.mp4',
    sourceSize: 1,
    sourceLastModified: 1,
    language: 'ru',
    provider: 'assemblyai',
    models: [],
    response: {
      words,
    },
  };
}

describe('transcription captions utils', () => {
  it('groups words into chunks using maxWordsPerClip and silence gap', () => {
    const result = buildCaptionChunks({
      record: createRecord([
        { start: 0, end: 200, text: 'hello' },
        { start: 210, end: 450, text: 'world' },
        { start: 900, end: 1200, text: 'again' },
      ]),
      settings: {
        maxWordsPerClip: 2,
        maxDurationMs: 5000,
        silenceGapMs: 300,
        splitOnPunctuation: true,
      },
    });

    expect(result.chunks).toEqual([
      {
        startMs: 0,
        endMs: 450,
        text: 'hello world',
        words: [
          { start: 0, end: 200, text: 'hello', confidence: undefined },
          { start: 210, end: 450, text: 'world', confidence: undefined },
        ],
      },
      {
        startMs: 900,
        endMs: 1200,
        text: 'again',
        words: [{ start: 900, end: 1200, text: 'again', confidence: undefined }],
      },
    ]);
  });

  it('splits on punctuation when enabled', () => {
    const result = buildCaptionChunks({
      record: createRecord([
        { start: 0, end: 200, text: 'Hello.' },
        { start: 220, end: 400, text: 'Next' },
        { start: 420, end: 700, text: 'phrase' },
      ]),
      settings: {
        ...createDefaultCaptionGenerationSettings(),
        maxWordsPerClip: 10,
        maxDurationMs: 5000,
        silenceGapMs: 1000,
        splitOnPunctuation: true,
      },
    });

    expect(result.chunks.map((chunk) => chunk.text)).toEqual(['Hello.', 'Next phrase']);
  });

  it('throws when cache record has no valid word timings', () => {
    expect(() =>
      buildCaptionChunks({
        record: {
          ...createRecord([]),
          response: { text: 'plain text only' },
        },
        settings: createDefaultCaptionGenerationSettings(),
      }),
    ).toThrow('Transcription cache does not contain word timings');
  });

  it('builds chunks from projected timeline words', () => {
    const result = buildCaptionChunksFromWords({
      words: [
        {
          start: 0,
          end: 200,
          text: 'hello',
          timelineStartMs: 1000,
          timelineEndMs: 1200,
          sourcePath: '_video/a.mp4',
          sourceName: 'a.mp4',
          trackId: 'v1',
          clipId: 'c1',
          trackOrder: 0,
        },
        {
          start: 220,
          end: 400,
          text: 'world',
          timelineStartMs: 1210,
          timelineEndMs: 1400,
          sourcePath: '_video/a.mp4',
          sourceName: 'a.mp4',
          trackId: 'v1',
          clipId: 'c1',
          trackOrder: 0,
        },
        {
          start: 500,
          end: 750,
          text: 'again',
          timelineStartMs: 2000,
          timelineEndMs: 2250,
          sourcePath: '_audio/b.wav',
          sourceName: 'b.wav',
          trackId: 'a1',
          clipId: 'c2',
          trackOrder: 2,
        },
      ],
      settings: {
        maxWordsPerClip: 2,
        maxDurationMs: 5000,
        silenceGapMs: 300,
        splitOnPunctuation: true,
      },
    });

    expect(result).toEqual([
      {
        startMs: 1000,
        endMs: 1400,
        text: 'hello world',
        words: [
          { start: 1000, end: 1200, text: 'hello', confidence: undefined },
          { start: 1210, end: 1400, text: 'world', confidence: undefined },
        ],
      },
      {
        startMs: 2000,
        endMs: 2250,
        text: 'again',
        words: [{ start: 2000, end: 2250, text: 'again', confidence: undefined }],
      },
    ]);
  });
});
