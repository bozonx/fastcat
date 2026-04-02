/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';

import { createTimelineSelectionModule as createTimelineSelection } from '~/stores/timeline/selection';
import type { TimelineDocument } from '~/timeline/types';

describe('timeline-selection', () => {
  function makeMockDoc(tracks: any[]): TimelineDocument {
    return {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc1',
      name: 'Test',
      timebase: { fps: 30 },
      tracks,
    };
  }

  function setup() {
    const timelineDoc = ref<TimelineDocument | null>(null);
    const currentTime = ref(0);
    const selectedItemIds = ref<string[]>([]);
    const selectedTrackId = ref<string | null>(null);
    const selectedTransition = ref<any | null>(null);

    const api = createTimelineSelection({
      timelineDoc,
      currentTime,
      selectedItemIds,
      selectedTrackId,
      selectedTransition,
    });

    return { api, timelineDoc, currentTime, selectedItemIds, selectedTrackId, selectedTransition };
  }

  it('toggles selection correctly', () => {
    const { api, selectedItemIds, selectedTransition } = setup();

    selectedTransition.value = { trackId: 't1', itemId: 'c1', edge: 'in' };

    // Select single
    api.toggleSelection('item1');
    expect(selectedItemIds.value).toEqual(['item1']);
    expect(selectedTransition.value).toBeNull();

    // Toggle different item (single)
    api.toggleSelection('item2');
    expect(selectedItemIds.value).toEqual(['item2']);

    // Multi-select
    api.toggleSelection('item3', { multi: true });
    expect(selectedItemIds.value).toEqual(['item2', 'item3']);

    // Toggle off multi-select
    api.toggleSelection('item2', { multi: true });
    expect(selectedItemIds.value).toEqual(['item3']);
  });

  it('gets hotkey target clip from selection first', () => {
    const { api, timelineDoc, selectedItemIds } = setup();

    timelineDoc.value = makeMockDoc([
      {
        id: 'track1',
        kind: 'video',
        items: [{ kind: 'clip', id: 'clip1' }],
      },
    ]);

    selectedItemIds.value = ['clip1'];

    const target = api.getHotkeyTargetClip();
    expect(target).toEqual({ trackId: 'track1', itemId: 'clip1' });
  });

  it('gets hotkey target clip from playhead on active track', () => {
    const { api, timelineDoc, currentTime, selectedTrackId } = setup();

    timelineDoc.value = makeMockDoc([
      {
        id: 'track1',
        kind: 'video',
        items: [
          {
            kind: 'clip',
            id: 'clip1',
            timelineRange: { startUs: 1_000_000, durationUs: 5_000_000 },
          },
        ],
      },
    ]);

    selectedTrackId.value = 'track1';
    currentTime.value = 2_000_000;

    const target = api.getHotkeyTargetClip();
    expect(target).toEqual({ trackId: 'track1', itemId: 'clip1' });
  });

  it('returns null if no hotkey target found', () => {
    const { api, timelineDoc, currentTime, selectedTrackId } = setup();

    timelineDoc.value = makeMockDoc([
      {
        id: 'track1',
        kind: 'video',
        items: [
          {
            kind: 'clip',
            id: 'clip1',
            timelineRange: { startUs: 1_000_000, durationUs: 5_000_000 },
          },
        ],
      },
    ]);

    selectedTrackId.value = 'track1';
    currentTime.value = 0; // Outside clip range

    expect(api.getHotkeyTargetClip()).toBeNull();
  });
});
