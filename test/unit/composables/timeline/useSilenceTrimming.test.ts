import { describe, expect, it, vi, beforeEach } from 'vitest';
import { TICKS_PER_SECOND } from '~/utils/time';
import type { TimelineDocument, TimelineTrack, TimelineMediaClipItem } from '~/timeline/types';
import type { TranscriptionRecord } from '~/utils/transcription/types';

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => mockTimelineStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/utils/transcription/persistence', () => ({
  loadTranscriptionSidecar: vi.fn(),
}));

vi.mock('~/utils/transcription/captions', () => ({
  extractTranscriptionWords: vi.fn(),
}));

const mockTimelineStore = {
  timelineDoc: null as TimelineDocument | null,
  applyTimeline: vi.fn(),
};

const mockWorkspaceStore = {
  workspaceHandle: {} as FileSystemDirectoryHandle,
};

function makeClip(overrides: Partial<TimelineMediaClipItem> = {}): TimelineMediaClipItem {
  return {
    id: 'c1',
    kind: 'clip',
    clipType: 'media',
    trackId: 'v1',
    name: 'Clip 1',
    timelineRange: { startUs: 0, durationUs: 10 * TICKS_PER_SECOND },
    sourceRange: { startUs: 0, durationUs: 10 * TICKS_PER_SECOND },
    sourceDurationUs: 10 * TICKS_PER_SECOND,
    source: { path: '/video.mp4' },
    ...overrides,
  };
}

function makeDoc(tracks: TimelineTrack[]): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'doc1',
    name: 'Test',
    timebase: { fps: 30 },
    tracks,
  };
}

function makeTrack(items: any[], overrides: Partial<TimelineTrack> = {}): TimelineTrack {
  return {
    id: 'v1',
    kind: 'video',
    name: 'Video 1',
    items,
    ...overrides,
  } as TimelineTrack;
}

function makeRecord(
  words: Array<{ start: number; end: number; text: string }>,
): TranscriptionRecord {
  return {
    createdAt: '2024-01-01',
    sourcePath: '/video.mp4',
    sourceName: 'video.mp4',
    sourceSize: 1000,
    sourceLastModified: 0,
    language: 'en',
    provider: 'test',
    models: [],
    response: { words },
  };
}

describe('useSilenceTrimming', () => {
  let applySilenceTrimming: (options: {
    clipIds: string[];
    settings: {
      trimStart: boolean;
      trimEnd: boolean;
      trimMiddle: boolean;
      mode: 'cut' | 'mark';
    };
  }) => Promise<{ missingTranscriptionCount: number } | undefined>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { useSilenceTrimming } = await import('~/composables/timeline/useSilenceTrimming');
    const { applySilenceTrimming: fn } = useSilenceTrimming();
    applySilenceTrimming = fn;
  });

  it('returns undefined when timelineDoc is null', async () => {
    mockTimelineStore.timelineDoc = null;

    const result = await applySilenceTrimming({
      clipIds: ['c1'],
      settings: { trimStart: true, trimEnd: true, trimMiddle: true, mode: 'cut' },
    });

    expect(result).toBeUndefined();
    expect(mockTimelineStore.applyTimeline).not.toHaveBeenCalled();
  });

  it('returns undefined when workspaceHandle is null', async () => {
    mockWorkspaceStore.workspaceHandle = null;
    mockTimelineStore.timelineDoc = makeDoc([makeTrack([makeClip()])]);

    const result = await applySilenceTrimming({
      clipIds: ['c1'],
      settings: { trimStart: true, trimEnd: true, trimMiddle: true, mode: 'cut' },
    });

    expect(result).toBeUndefined();
    mockWorkspaceStore.workspaceHandle = {} as FileSystemDirectoryHandle;
  });

  it('counts missing transcriptions', async () => {
    const { loadTranscriptionSidecar } = await import('~/utils/transcription/persistence');
    vi.mocked(loadTranscriptionSidecar).mockResolvedValue(null);

    mockTimelineStore.timelineDoc = makeDoc([makeTrack([makeClip()])]);

    const result = await applySilenceTrimming({
      clipIds: ['c1'],
      settings: { trimStart: true, trimEnd: true, trimMiddle: true, mode: 'cut' },
    });

    expect(result?.missingTranscriptionCount).toBe(1);
    expect(mockTimelineStore.applyTimeline).not.toHaveBeenCalled();
  });

  it('detects start pause before first word', async () => {
    const { loadTranscriptionSidecar } = await import('~/utils/transcription/persistence');
    const { extractTranscriptionWords } = await import('~/utils/transcription/captions');

    const clip = makeClip({
      timelineRange: { startUs: 0, durationUs: 10 * TICKS_PER_SECOND },
      sourceRange: { startUs: 0, durationUs: 10 * TICKS_PER_SECOND },
    });
    mockTimelineStore.timelineDoc = makeDoc([makeTrack([clip])]);

    vi.mocked(loadTranscriptionSidecar).mockResolvedValue(
      makeRecord([{ start: 2000, end: 5000, text: 'hello' }]),
    );
    vi.mocked(extractTranscriptionWords).mockReturnValue([
      { start: 2000, end: 5000, text: 'hello' },
    ]);

    await applySilenceTrimming({
      clipIds: ['c1'],
      settings: { trimStart: true, trimEnd: false, trimMiddle: false, mode: 'cut' },
    });

    expect(mockTimelineStore.applyTimeline).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockTimelineStore.applyTimeline).mock.calls[0]!;
    const command = call[0] as {
      type: string;
      clips: Array<{ pauses: Array<{ startUs: number; endUs: number }> }>;
    };
    expect(command.type).toBe('auto_trim_pauses');
    // Start pause: firstWordStartMs = 2000ms = 2s, sourceRange.startUs = 0
    // endUs = 0 + (2s - 0) / 1 = 2s in ticks
    expect(command.clips[0]!.pauses).toEqual([{ startUs: 0, endUs: 2 * TICKS_PER_SECOND }]);
  });

  it('detects end pause after last word', async () => {
    const { loadTranscriptionSidecar } = await import('~/utils/transcription/persistence');
    const { extractTranscriptionWords } = await import('~/utils/transcription/captions');

    const clip = makeClip({
      timelineRange: { startUs: 0, durationUs: 10 * TICKS_PER_SECOND },
      sourceRange: { startUs: 0, durationUs: 10 * TICKS_PER_SECOND },
    });
    mockTimelineStore.timelineDoc = makeDoc([makeTrack([clip])]);

    vi.mocked(loadTranscriptionSidecar).mockResolvedValue(
      makeRecord([{ start: 1000, end: 3000, text: 'hello' }]),
    );
    vi.mocked(extractTranscriptionWords).mockReturnValue([
      { start: 1000, end: 3000, text: 'hello' },
    ]);

    await applySilenceTrimming({
      clipIds: ['c1'],
      settings: { trimStart: false, trimEnd: true, trimMiddle: false, mode: 'cut' },
    });

    const call = vi.mocked(mockTimelineStore.applyTimeline).mock.calls[0]!;
    const command = call[0] as {
      type: string;
      clips: Array<{ pauses: Array<{ startUs: number; endUs: number }> }>;
    };
    // End pause: lastWordEndMs = 3000ms = 3s
    // startUs = 0 + (3s - 0) / 1 = 3s, endUs = 0 + 10s = 10s
    expect(command.clips[0]!.pauses).toEqual([
      { startUs: 3 * TICKS_PER_SECOND, endUs: 10 * TICKS_PER_SECOND },
    ]);
  });

  it('detects middle pauses longer than 500ms', async () => {
    const { loadTranscriptionSidecar } = await import('~/utils/transcription/persistence');
    const { extractTranscriptionWords } = await import('~/utils/transcription/captions');

    const clip = makeClip({
      timelineRange: { startUs: 0, durationUs: 10 * TICKS_PER_SECOND },
      sourceRange: { startUs: 0, durationUs: 10 * TICKS_PER_SECOND },
    });
    mockTimelineStore.timelineDoc = makeDoc([makeTrack([clip])]);

    vi.mocked(loadTranscriptionSidecar).mockResolvedValue(
      makeRecord([
        { start: 1000, end: 2000, text: 'hello' },
        { start: 3000, end: 4000, text: 'world' },
      ]),
    );
    vi.mocked(extractTranscriptionWords).mockReturnValue([
      { start: 1000, end: 2000, text: 'hello' },
      { start: 3000, end: 4000, text: 'world' },
    ]);

    await applySilenceTrimming({
      clipIds: ['c1'],
      settings: { trimStart: false, trimEnd: false, trimMiddle: true, mode: 'cut' },
    });

    const call = vi.mocked(mockTimelineStore.applyTimeline).mock.calls[0]!;
    const command = call[0] as {
      type: string;
      clips: Array<{ pauses: Array<{ startUs: number; endUs: number }> }>;
    };
    // Gap: 2000ms to 3000ms => 1s gap in ticks (1s > 500ms threshold)
    expect(command.clips[0]!.pauses).toEqual([
      { startUs: 2 * TICKS_PER_SECOND, endUs: 3 * TICKS_PER_SECOND },
    ]);
  });

  it('does not detect middle pauses shorter than 500ms', async () => {
    const { loadTranscriptionSidecar } = await import('~/utils/transcription/persistence');
    const { extractTranscriptionWords } = await import('~/utils/transcription/captions');

    const clip = makeClip({
      timelineRange: { startUs: 0, durationUs: 10 * TICKS_PER_SECOND },
      sourceRange: { startUs: 0, durationUs: 10 * TICKS_PER_SECOND },
    });
    mockTimelineStore.timelineDoc = makeDoc([makeTrack([clip])]);

    vi.mocked(loadTranscriptionSidecar).mockResolvedValue(
      makeRecord([
        { start: 1000, end: 2000, text: 'hello' },
        { start: 2300, end: 3000, text: 'world' },
      ]),
    );
    vi.mocked(extractTranscriptionWords).mockReturnValue([
      { start: 1000, end: 2000, text: 'hello' },
      { start: 2300, end: 3000, text: 'world' },
    ]);

    await applySilenceTrimming({
      clipIds: ['c1'],
      settings: { trimStart: false, trimEnd: false, trimMiddle: true, mode: 'mark' },
    });

    // Gap is 300ms < 500ms threshold, no pauses detected
    expect(mockTimelineStore.applyTimeline).not.toHaveBeenCalled();
  });

  it('divides source time by absSpeed for timeline position', async () => {
    const { loadTranscriptionSidecar } = await import('~/utils/transcription/persistence');
    const { extractTranscriptionWords } = await import('~/utils/transcription/captions');

    const clip = makeClip({
      speed: 2,
      timelineRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
      sourceRange: { startUs: 0, durationUs: 10 * TICKS_PER_SECOND },
    });
    mockTimelineStore.timelineDoc = makeDoc([makeTrack([clip])]);

    vi.mocked(loadTranscriptionSidecar).mockResolvedValue(
      makeRecord([{ start: 4000, end: 8000, text: 'hello' }]),
    );
    vi.mocked(extractTranscriptionWords).mockReturnValue([
      { start: 4000, end: 8000, text: 'hello' },
    ]);

    await applySilenceTrimming({
      clipIds: ['c1'],
      settings: { trimStart: true, trimEnd: false, trimMiddle: false, mode: 'cut' },
    });

    const call = vi.mocked(mockTimelineStore.applyTimeline).mock.calls[0]!;
    const command = call[0] as {
      type: string;
      clips: Array<{ pauses: Array<{ startUs: number; endUs: number }> }>;
    };
    // firstWordStartMs = 4000ms = 4s, sourceRange.startUs = 0
    // endUs = 0 + (4s - 0) / 2 = 2s in ticks
    expect(command.clips[0]!.pauses).toEqual([{ startUs: 0, endUs: 2 * TICKS_PER_SECOND }]);
  });

  it('skips clips without source path', async () => {
    const clip = makeClip({ source: undefined as any });
    mockTimelineStore.timelineDoc = makeDoc([makeTrack([clip])]);

    const result = await applySilenceTrimming({
      clipIds: ['c1'],
      settings: { trimStart: true, trimEnd: true, trimMiddle: true, mode: 'cut' },
    });

    expect(mockTimelineStore.applyTimeline).not.toHaveBeenCalled();
  });

  it('skips non-media clips', async () => {
    const textClip = {
      id: 't1',
      kind: 'clip',
      clipType: 'text',
      trackId: 'v1',
      name: 'Text',
      timelineRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
      sourceRange: { startUs: 0, durationUs: 5 * TICKS_PER_SECOND },
      text: 'hello',
    };
    mockTimelineStore.timelineDoc = makeDoc([makeTrack([textClip as any])]);

    await applySilenceTrimming({
      clipIds: ['t1'],
      settings: { trimStart: true, trimEnd: true, trimMiddle: true, mode: 'cut' },
    });

    expect(mockTimelineStore.applyTimeline).not.toHaveBeenCalled();
  });

  it('passes mode through to applyTimeline', async () => {
    const { loadTranscriptionSidecar } = await import('~/utils/transcription/persistence');
    const { extractTranscriptionWords } = await import('~/utils/transcription/captions');

    const clip = makeClip();
    mockTimelineStore.timelineDoc = makeDoc([makeTrack([clip])]);

    vi.mocked(loadTranscriptionSidecar).mockResolvedValue(
      makeRecord([{ start: 2000, end: 5000, text: 'hello' }]),
    );
    vi.mocked(extractTranscriptionWords).mockReturnValue([
      { start: 2000, end: 5000, text: 'hello' },
    ]);

    await applySilenceTrimming({
      clipIds: ['c1'],
      settings: { trimStart: true, trimEnd: false, trimMiddle: false, mode: 'mark' },
    });

    const call = vi.mocked(mockTimelineStore.applyTimeline).mock.calls[0]!;
    const command = call[0] as { type: string; mode: string };
    expect(command.mode).toBe('mark');
  });
});
