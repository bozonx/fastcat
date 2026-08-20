/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useClipAudio } from '~/composables/properties/useClipAudio';
import type { TimelineClipItem, TimelineTrack, TimelineDocument } from '~/timeline/types';

describe('useClipAudio', () => {
  const createMockClip = (gain = 1): TimelineClipItem =>
    ({
      id: 'clip_1',
      trackId: 'track_1',
      kind: 'clip',
      clipType: 'media',
      name: 'Test Clip',
      timelineRange: { startTicks: 0, durationTicks: 5000000 },
      audioGain: gain,
      audioBalance: 0,
      audioFadeInTicks: 0,
      audioFadeOutTicks: 0,
      audioFadeInCurve: 'linear',
      audioFadeOutCurve: 'linear',
      sourceRange: { startTicks: 0, durationTicks: 5000000 },
      sourceDurationTicks: 5000000,
    }) as unknown as TimelineClipItem;

  const createMockDoc = (): TimelineDocument =>
    ({
      id: 'doc_1',
      tracks: [
        {
          id: 'track_1',
          kind: 'audio',
          items: [],
        },
      ],
    }) as unknown as TimelineDocument;

  it('handles basic audioGain updates without drag', () => {
    const clip = ref(createMockClip(1));
    const updateAudio = vi.fn();
    const api = useClipAudio({
      clip,
      tracks: ref([]),
      mediaMetadataByPath: ref({}),
      updateAudio,
    });

    api.updateAudioGain(0.5);

    expect(updateAudio).toHaveBeenCalledWith(
      expect.objectContaining({ audioGain: 0.5 }),
      undefined,
    );
  });

  it('clones and stores document snapshot on drag start, skips history during drag updates, and pushes history on drag end', () => {
    const clip = ref(createMockClip(1));
    const updateAudio = vi.fn();
    const pushHistory = vi.fn();
    const mockDoc = createMockDoc();
    const getTimelineDoc = vi.fn(() => mockDoc);

    const api = useClipAudio({
      clip,
      tracks: ref([]),
      mediaMetadataByPath: ref({}),
      updateAudio,
      pushHistory,
      getTimelineDoc,
    });

    // 1. Start drag
    api.onVolumeDragStart();
    expect(getTimelineDoc).toHaveBeenCalled();

    // 2. Perform updates during drag (should skip history)
    api.updateAudioGain(0.8, { skipHistory: true });
    expect(updateAudio).toHaveBeenLastCalledWith(
      expect.objectContaining({ audioGain: 0.8 }),
      expect.objectContaining({ skipHistory: true }),
    );

    // 3. End drag (should push history with pre-drag doc)
    api.onVolumeDragEnd();
    expect(pushHistory).toHaveBeenCalledWith(
      mockDoc,
      'update_clip_properties',
      'videoEditor.fileManager.history.entries.updateClipGain',
    );
  });
});
