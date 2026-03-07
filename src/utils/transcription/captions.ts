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

export interface TimelineCaptionWord extends TranscriptionWord {
  timelineStartMs: number;
  timelineEndMs: number;
  sourcePath: string;
  sourceName: string;
  trackId: string;
  clipId: string;
  trackOrder: number;
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

export function extractTranscriptionWords(record: TranscriptionCacheRecord): TranscriptionWord[] {
  const response = record.response as { words?: unknown } | null;
  const rawWords = Array.isArray(response?.words) ? response.words : [];

  return rawWords
    .filter(isWordLike)
    .map(normalizeWord)
    .filter((word): word is TranscriptionWord => word !== null);
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
    text: words
      .map((word) => word.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    words: [...words],
  };
}

function timelineWordsToChunk(words: TimelineCaptionWord[]): CaptionChunk | null {
  const first = words[0];
  const last = words[words.length - 1];
  if (!first || !last) return null;

  return {
    startMs: first.timelineStartMs,
    endMs: last.timelineEndMs,
    text: words
      .map((word) => word.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    words: words.map((word) => ({
      start: word.timelineStartMs,
      end: word.timelineEndMs,
      text: word.text,
      confidence: word.confidence,
    })),
  };
}

function normalizeCaptionChunks(chunks: CaptionChunk[]): CaptionChunk[] {
  const sortedChunks = [...chunks].sort((a, b) => {
    if (a.startMs !== b.startMs) {
      return a.startMs - b.startMs;
    }

    return a.endMs - b.endMs;
  });

  const normalized: CaptionChunk[] = [];
  for (const chunk of sortedChunks) {
    const previousChunk = normalized[normalized.length - 1] ?? null;
    const nextStartMs = previousChunk
      ? Math.max(chunk.startMs, previousChunk.endMs)
      : chunk.startMs;
    const nextEndMs = Math.max(nextStartMs, chunk.endMs);
    if (nextEndMs <= nextStartMs) continue;

    normalized.push({
      ...chunk,
      startMs: nextStartMs,
      endMs: nextEndMs,
      words: chunk.words
        .map((word) => ({
          ...word,
          start: Math.max(word.start, nextStartMs),
          end: Math.max(Math.max(word.start, nextStartMs), Math.min(word.end, nextEndMs)),
        }))
        .filter((word) => word.end > word.start),
    });
  }

  return normalized;
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

export function buildCaptionChunksFromWords(params: {
  words: TimelineCaptionWord[];
  settings: CaptionGenerationSettings;
}): CaptionChunk[] {
  if (params.words.length === 0) {
    throw new Error('Transcription cache does not contain word timings');
  }

  const chunks: CaptionChunk[] = [];
  let currentWords: TimelineCaptionWord[] = [];

  const words = [...params.words].sort((a, b) => {
    if (a.timelineStartMs !== b.timelineStartMs) {
      return a.timelineStartMs - b.timelineStartMs;
    }

    if (a.timelineEndMs !== b.timelineEndMs) {
      return a.timelineEndMs - b.timelineEndMs;
    }

    return a.trackOrder - b.trackOrder;
  });

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    currentWords.push(word);

    const nextWord = words[index + 1] ?? null;
    const currentDurationMs = word.timelineEndMs - currentWords[0]!.timelineStartMs;
    const nextGapMs = nextWord
      ? Math.max(0, nextWord.timelineStartMs - word.timelineEndMs)
      : Number.POSITIVE_INFINITY;

    if (
      shouldSplitAtWord({
        currentWords: currentWords.map((currentWord) => ({
          start: currentWord.timelineStartMs,
          end: currentWord.timelineEndMs,
          text: currentWord.text,
          confidence: currentWord.confidence,
        })),
        currentDurationMs,
        nextGapMs,
        settings: params.settings,
      })
    ) {
      const chunk = timelineWordsToChunk(currentWords);
      if (chunk) {
        chunks.push(chunk);
      }
      currentWords = [];
    }
  }

  if (currentWords.length > 0) {
    const chunk = timelineWordsToChunk(currentWords);
    if (chunk) {
      chunks.push(chunk);
    }
  }

  if (chunks.length === 0) {
    throw new Error('Failed to build caption chunks from transcription cache');
  }

  return normalizeCaptionChunks(chunks);
}

export function buildCaptionChunks(params: {
  record: TranscriptionCacheRecord;
  settings: CaptionGenerationSettings;
}): { chunks: CaptionChunk[]; sourceName: string; sourcePath: string } {
  const words = extractTranscriptionWords(params.record);
  if (words.length === 0) {
    throw new Error('Transcription cache does not contain word timings');
  }

  const chunks = words
    .map((word) => ({
      ...word,
      timelineStartMs: word.start,
      timelineEndMs: word.end,
      sourcePath: params.record.sourcePath,
      sourceName: params.record.sourceName,
      trackId: '',
      clipId: '',
      trackOrder: 0,
    }))
    .slice();

  return {
    chunks: buildCaptionChunksFromWords({ words: chunks, settings: params.settings }),
    sourceName: params.record.sourceName,
    sourcePath: params.record.sourcePath,
  };
}
