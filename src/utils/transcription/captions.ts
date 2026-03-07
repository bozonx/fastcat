import type { TextClipStyle } from '~/timeline/types';
import type { TranscriptionCacheRecord } from '~/repositories/transcription-cache.repository';

export interface TranscriptionWord {
  start: number;
  end: number;
  text: string;
  confidence?: number;
}

export interface CaptionGenerationSettings {
  maxWordsPerClip: number;
  maxDurationMs: number;
  silenceGapMs: number;
  splitOnPunctuation: boolean;
}

export interface CaptionChunk {
  startMs: number;
  endMs: number;
  text: string;
  words: TranscriptionWord[];
}

export interface CaptionGenerationResult {
  chunks: CaptionChunk[];
  sourceName: string;
  sourcePath: string;
}

export interface CaptionStylePreset {
  textStyle: TextClipStyle;
}

function isWordLike(value: unknown): value is TranscriptionWord {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.start === 'number' &&
    Number.isFinite(candidate.start) &&
    typeof candidate.end === 'number' &&
    Number.isFinite(candidate.end) &&
    typeof candidate.text === 'string'
  );
}

function normalizeWord(word: TranscriptionWord): TranscriptionWord | null {
  const text = word.text.trim();
  if (!text) return null;

  const start = Math.max(0, Math.round(word.start));
  const end = Math.max(start, Math.round(word.end));
  if (end <= start) return null;

  return {
    start,
    end,
    text,
    confidence: typeof word.confidence === 'number' ? word.confidence : undefined,
  };
}

function extractWords(record: TranscriptionCacheRecord): TranscriptionWord[] {
  const response = record.response as { words?: unknown } | null;
  const rawWords = Array.isArray(response?.words) ? response.words : [];

  return rawWords.filter(isWordLike).map(normalizeWord).filter((word): word is TranscriptionWord => word !== null);
}

function shouldSplitAtWord(params: {
  currentWords: TranscriptionWord[];
  currentDurationMs: number;
  nextGapMs: number;
  settings: CaptionGenerationSettings;
}): boolean {
  const lastWord = params.currentWords[params.currentWords.length - 1];
  if (!lastWord) return false;

  if (params.currentWords.length >= params.settings.maxWordsPerClip) {
    return true;
  }

  if (params.currentDurationMs >= params.settings.maxDurationMs) {
    return true;
  }

  if (params.nextGapMs >= params.settings.silenceGapMs) {
    return true;
  }

  if (params.settings.splitOnPunctuation && /[.!?…]$/.test(lastWord.text)) {
    return true;
  }

  return false;
}

function wordsToChunk(words: TranscriptionWord[]): CaptionChunk | null {
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) return null;

  return {
    startMs: first.start,
    endMs: last.end,
    text: words.map((word) => word.text).join(' ').replace(/\s+/g, ' ').trim(),
    words: [...words],
  };
}

export function createDefaultCaptionStylePreset(): CaptionStylePreset {
  return {
    textStyle: {
      fontSize: 72,
      fontWeight: 700,
      color: '#ffffff',
      align: 'center',
      verticalAlign: 'bottom',
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      padding: { top: 24, right: 40, bottom: 24, left: 40 },
      lineHeight: 1.1,
      width: 1400,
    },
  };
}

export function createDefaultCaptionGenerationSettings(): CaptionGenerationSettings {
  return {
    maxWordsPerClip: 5,
    maxDurationMs: 2200,
    silenceGapMs: 350,
    splitOnPunctuation: true,
  };
}

export function buildCaptionChunks(params: {
  record: TranscriptionCacheRecord;
  settings: CaptionGenerationSettings;
}): CaptionGenerationResult {
  const words = extractWords(params.record);
  if (words.length === 0) {
    throw new Error('Transcription cache does not contain word timings');
  }

  const chunks: CaptionChunk[] = [];
  let currentWords: TranscriptionWord[] = [];

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    currentWords.push(word);

    const nextWord = words[index + 1] ?? null;
    const currentDurationMs = word.end - currentWords[0]!.start;
    const nextGapMs = nextWord ? Math.max(0, nextWord.start - word.end) : Number.POSITIVE_INFINITY;

    if (
      shouldSplitAtWord({
        currentWords,
        currentDurationMs,
        nextGapMs,
        settings: params.settings,
      })
    ) {
      const chunk = wordsToChunk(currentWords);
      if (chunk) {
        chunks.push(chunk);
      }
      currentWords = [];
    }
  }

  if (currentWords.length > 0) {
    const chunk = wordsToChunk(currentWords);
    if (chunk) {
      chunks.push(chunk);
    }
  }

  if (chunks.length === 0) {
    throw new Error('Failed to build caption chunks from transcription cache');
  }

  return {
    chunks,
    sourceName: params.record.sourceName,
    sourcePath: params.record.sourcePath,
  };
}
