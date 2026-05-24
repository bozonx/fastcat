// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { handleTimelineSerializeMessage } from '~/workers/timeline-serializer-engine';
import * as otioSerializer from '~/timeline/otio-serializer';
import type { TimelineDocument } from '~/timeline/types';

vi.mock('~/timeline/otio-serializer', () => ({
  serializeTimelineToOtio: vi.fn(),
}));

describe('handleTimelineSerializeMessage', () => {
  it('returns serialized document on success', () => {
    const doc = { OTIO_SCHEMA: 'Timeline.1' as const, id: '1', name: 'Test' } as TimelineDocument;
    vi.mocked(otioSerializer.serializeTimelineToOtio).mockReturnValue('serialized-json');

    const result = handleTimelineSerializeMessage(doc);

    expect(result).toEqual({ success: true, serialized: 'serialized-json' });
    expect(otioSerializer.serializeTimelineToOtio).toHaveBeenCalledWith(doc);
  });

  it('returns error message when serialization throws', () => {
    const doc = { OTIO_SCHEMA: 'Timeline.1' as const, id: '2', name: 'Fail' } as TimelineDocument;
    vi.mocked(otioSerializer.serializeTimelineToOtio).mockImplementation(() => {
      throw new Error('serialization failed');
    });

    const result = handleTimelineSerializeMessage(doc);

    expect(result).toEqual({ success: false, error: 'serialization failed' });
  });

  it('returns stringified error for non-Error throws', () => {
    const doc = { OTIO_SCHEMA: 'Timeline.1' as const, id: '3', name: 'Symbol' } as TimelineDocument;
    vi.mocked(otioSerializer.serializeTimelineToOtio).mockImplementation(() => {
      throw 'custom error';
    });

    const result = handleTimelineSerializeMessage(doc);

    expect(result).toEqual({ success: false, error: 'custom error' });
  });
});
