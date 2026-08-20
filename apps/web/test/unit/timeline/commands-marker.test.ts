import { describe, it, expect } from 'vitest';
import { addMarker, updateMarker, removeMarker } from '~/timeline/commands/markerHandlers';
import type { TimelineDocument, TimelineMarker } from '~/timeline/types';

function createDoc(markers: TimelineMarker[] = []): TimelineDocument {
  return {
    OTIO_SCHEMA: 'Timeline.1',
    id: 'test',
    name: 'Test',
    timebase: { fps: 30 },
    tracks: [],
    metadata: {
      fastcat: {
        markers,
      },
    },
  } as unknown as TimelineDocument;
}

describe('markerHandlers', () => {
  describe('addMarker', () => {
    it('adds a marker to an empty list', () => {
      const doc = createDoc();
      const result = addMarker(doc, {
        type: 'add_marker',
        id: 'm1',
        // Frame-aligned at 30fps (markers always snap to the frame grid).
        timeTicks: 254_016_000_000,
        text: 'hello',
      });
      const markers =
        (result.next.metadata?.fastcat as { markers?: TimelineMarker[] })?.markers ?? [];
      expect(markers).toHaveLength(1);
      expect(markers[0]!.id).toBe('m1');
      expect(markers[0]!.timeTicks).toBe(254_016_000_000);
    });

    it('sorts markers by timeTicks', () => {
      const doc = createDoc([{ id: 'm2', timeTicks: 2000, text: '' }] as TimelineMarker[]);
      const result = addMarker(doc, {
        type: 'add_marker',
        id: 'm1',
        timeTicks: 1000,
        text: '',
      });
      const markers =
        (result.next.metadata?.fastcat as { markers?: TimelineMarker[] })?.markers ?? [];
      expect(markers[0]!.id).toBe('m1');
      expect(markers[1]!.id).toBe('m2');
    });

    it('throws if marker already exists', () => {
      const doc = createDoc([{ id: 'm1', timeTicks: 1000, text: '' }] as TimelineMarker[]);
      expect(() =>
        addMarker(doc, {
          type: 'add_marker',
          id: 'm1',
          timeTicks: 2000,
          text: '',
        }),
      ).toThrow('Marker already exists');
    });

    it('throws if another marker already exists at the same time', () => {
      const doc = createDoc([
        { id: 'm1', timeTicks: 254_016_000_000, text: '' },
      ] as TimelineMarker[]);
      expect(() =>
        addMarker(doc, {
          type: 'add_marker',
          id: 'm2',
          timeTicks: 254_016_000_000,
          text: '',
        }),
      ).toThrow('Marker already exists at this time');
    });
  });

  describe('updateMarker', () => {
    it('updates marker timeTicks', () => {
      const doc = createDoc([{ id: 'm1', timeTicks: 1000, text: '' }] as TimelineMarker[]);
      const result = updateMarker(doc, {
        type: 'update_marker',
        id: 'm1',
        timeTicks: 762_048_000_000,
      });
      const markers =
        (result.next.metadata?.fastcat as { markers?: TimelineMarker[] })?.markers ?? [];
      expect(markers[0]!.timeTicks).toBe(762_048_000_000);
    });

    it('updates marker durationTicks', () => {
      const doc = createDoc([{ id: 'm1', timeTicks: 1000, text: '' }] as TimelineMarker[]);
      const result = updateMarker(doc, {
        type: 'update_marker',
        id: 'm1',
        durationTicks: 127_008_000_000,
      });
      const markers =
        (result.next.metadata?.fastcat as { markers?: TimelineMarker[] })?.markers ?? [];
      expect(markers[0]!.durationTicks).toBe(127_008_000_000);
    });

    it('updates marker text', () => {
      const doc = createDoc([{ id: 'm1', timeTicks: 1000, text: '' }] as TimelineMarker[]);
      const result = updateMarker(doc, {
        type: 'update_marker',
        id: 'm1',
        text: 'updated',
      });
      const markers =
        (result.next.metadata?.fastcat as { markers?: TimelineMarker[] })?.markers ?? [];
      expect(markers[0]!.text).toBe('updated');
    });

    it('throws if moving a marker onto another marker time', () => {
      const doc = createDoc([
        { id: 'm1', timeTicks: 254_016_000_000, text: '' },
        { id: 'm2', timeTicks: 508_032_000_000, text: '' },
      ] as TimelineMarker[]);

      expect(() =>
        updateMarker(doc, {
          type: 'update_marker',
          id: 'm2',
          timeTicks: 254_016_000_000,
        }),
      ).toThrow('Marker already exists at this time');
    });

    it('throws if quantized update lands on another marker time', () => {
      const doc = createDoc([
        { id: 'm1', timeTicks: 254_016_000_000, text: '' },
        { id: 'm2', timeTicks: 508_032_000_000, text: '' },
      ] as TimelineMarker[]);

      expect(() =>
        updateMarker(doc, {
          type: 'update_marker',
          id: 'm2',
          timeTicks: 254_015_745_984,
        }),
      ).toThrow('Marker already exists at this time');
    });

    it('returns doc unchanged when marker is not found (defensive)', () => {
      const doc = createDoc([{ id: 'm1', timeTicks: 1000, text: '' }] as TimelineMarker[]);
      const result = updateMarker(doc, {
        type: 'update_marker',
        id: 'missing',
        timeTicks: 2000,
      });
      expect(result.next).toBe(doc);
    });
  });

  describe('removeMarker', () => {
    it('removes an existing marker', () => {
      const doc = createDoc([
        { id: 'm1', timeTicks: 1000, text: '' },
        { id: 'm2', timeTicks: 2000, text: '' },
      ] as TimelineMarker[]);
      const result = removeMarker(doc, {
        type: 'remove_marker',
        id: 'm1',
      });
      const markers =
        (result.next.metadata?.fastcat as { markers?: TimelineMarker[] })?.markers ?? [];
      expect(markers).toHaveLength(1);
      expect(markers[0]!.id).toBe('m2');
    });

    it('returns doc unchanged when marker is not found', () => {
      const doc = createDoc([{ id: 'm1', timeTicks: 1000, text: '' }] as TimelineMarker[]);
      const result = removeMarker(doc, {
        type: 'remove_marker',
        id: 'missing',
      });
      expect(result.next).toBe(doc);
    });
  });
});
