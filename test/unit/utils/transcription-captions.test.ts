import { describe, it, expect } from 'vitest';
import {
  buildCaptionChunks,
  createDefaultCaptionGenerationSettings,
} from '../../../src/utils/transcription/captions';
import type { TranscriptionCacheRecord } from '../../../src/repositories/transcription-cache.repository';

function createRecord(words: Array<{ start: number; end: number; text: string }>): TranscriptionCacheRecord {
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
});
