/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  createDefaultTimelineDocument,
  serializeTimelineToOtio,
  parseTimelineFromOtio,
} from '~/timeline/otio-serializer';

vi.mock('~/timeline/format', () => ({
  getTimelineFormat: vi.fn(() => ({ fps: 30, width: 1920, height: 1080 })),
  normalizeTimelineFormat: vi.fn((input) => input ?? { fps: 30, width: 1920, height: 1080 }),
}));

vi.mock('~/timeline/otio/utils', () => ({
  toTimeRange: vi.fn((range) => range),
  trackKindToOtioKind: vi.fn((kind) => (kind === 'audio' ? 'Audio' : 'Video')),
  trackKindFromOtioKind: vi.fn((kind) => (kind === 'Audio' ? 'audio' : 'video')),
  normalizeTrackKind: vi.fn((kind) => kind),
  assertTimelineTimebase: vi.fn((tb) => tb ?? { fps: 30 }),
  coerceId: vi.fn((id, fallback) => id ?? fallback),
  coerceName: vi.fn((name, fallback) => name ?? fallback),
  coerceBlendMode: vi.fn((bm) => bm),
  safeFastCatMetadata: vi.fn((meta) => meta ?? {}),
  toOtioColor: vi.fn((color) => color),
  fromOtioColor: vi.fn((color) => color),
  OtioValidationReport: vi.fn(function () {
    return { warn: vi.fn(), log: vi.fn() };
  }),
}));

vi.mock('~/timeline/otio/serialization', () => ({
  serializeEffects: vi.fn(() => undefined),
  parseEffects: vi.fn(() => []),
  serializeMarker: vi.fn(() => ({})),
  parseOtioMarkers: vi.fn(() => []),
  buildOtioTransition: vi.fn(() => null),
  parseOtioTransition: vi.fn(() => null),
  serializeTimeEffects: vi.fn(() => []),
  parseTimeEffects: vi.fn(() => []),
}));

vi.mock('~/timeline/otio/items', () => ({
  parseGapItem: vi.fn(() => ({
    id: 'gap-1',
    kind: 'gap',
    timelineRange: { startUs: 0, durationUs: 1_000_000 },
  })),
  parseClipItem: vi.fn(() => ({
    id: 'clip-1',
    kind: 'clip',
    timelineRange: { startUs: 0, durationUs: 1_000_000 },
  })),
  parseItemSequenceDurationUs: vi.fn(() => 1_000_000),
}));

vi.mock('~/timeline/otio/schemas', () => ({
  TimelineDocFastCatMetaSchema: {
    parse: vi.fn(() => ({ document: { docId: 'parsed-doc' }, version: 1 })),
  },
  TimelineTrackFastCatMetaSchema: { parse: vi.fn(() => ({})) },
  TimelineClipFastCatMetaSchema: { parse: vi.fn(() => ({})) },
}));

describe('createDefaultTimelineDocument', () => {
  it('creates a document with default tracks', () => {
    const doc = createDefaultTimelineDocument({ id: 'doc-1', name: 'Test', format: { fps: 30 } });
    expect(doc.id).toBe('doc-1');
    expect(doc.name).toBe('Test');
    expect(doc.tracks).toHaveLength(4);
    expect(doc.tracks[0].kind).toBe('video');
    expect(doc.tracks[2].kind).toBe('audio');
  });
});

describe('serializeTimelineToOtio', () => {
  it('returns a JSON string with Timeline.1 schema', () => {
    const doc = createDefaultTimelineDocument({ id: 'doc-1', name: 'Test', format: { fps: 30 } });
    const result = serializeTimelineToOtio(doc);
    expect(result).toContain('Timeline.1');
    expect(result).toContain('Test');
  });
});

describe('parseTimelineFromOtio', () => {
  it('falls back to default doc on invalid JSON', () => {
    const doc = parseTimelineFromOtio('not-json', {
      id: 'fb',
      name: 'Fallback',
      format: { fps: 30 },
    });
    expect(doc.id).toBe('fb');
    expect(doc.name).toBe('Fallback');
    expect(doc.tracks).toHaveLength(4);
  });

  it('falls back to default doc on wrong schema', () => {
    const doc = parseTimelineFromOtio(JSON.stringify({ OTIO_SCHEMA: 'Stack.1' }), {
      id: 'fb',
      name: 'Fallback',
      format: { fps: 30 },
    });
    expect(doc.id).toBe('fb');
    expect(doc.name).toBe('Fallback');
  });

  it('parses a valid Timeline.1 document', () => {
    const otio = JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1',
      name: 'Parsed',
      tracks: {
        OTIO_SCHEMA: 'Stack.1',
        children: [
          {
            OTIO_SCHEMA: 'Track.1',
            kind: 'Video',
            name: 'Video 1',
            children: [],
            metadata: { fastcat: { id: 'v1', kind: 'video' } },
          },
          {
            OTIO_SCHEMA: 'Track.1',
            kind: 'Audio',
            name: 'Audio 1',
            children: [],
            metadata: { fastcat: { id: 'a1', kind: 'audio' } },
          },
        ],
      },
      metadata: {
        fastcat: {
          schema: 'fastcat.otio.v1',
          version: 1,
          document: {
            docId: 'parsed-doc',
            timebase: { fps: 30 },
            format: { fps: 30, width: 1920, height: 1080 },
          },
        },
      },
    });

    const doc = parseTimelineFromOtio(otio, { id: 'fb', name: 'Fallback', format: { fps: 30 } });
    expect(doc.id).toBe('parsed-doc');
    expect(doc.name).toBe('Parsed');
    expect(doc.tracks).toHaveLength(2);
    expect(doc.tracks[0].kind).toBe('video');
    expect(doc.tracks[1].kind).toBe('audio');
  });
});
