import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { buildMultiSelectionContextMenu } from '~/composables/timeline/clip-context-menu/buildMultiSelectionContextMenu';
import type { UseClipContextMenuOptions } from '~/composables/timeline/clip-context-menu/types';

function createOptions(selectedItemIds: string[]): UseClipContextMenuOptions {
  const audioClip = {
    id: 'audio-1',
    kind: 'clip' as const,
    trackId: 'a1',
    clipType: 'media' as const,
    name: 'Audio',
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
    sourceDurationUs: 5_000_000,
  };
  const textClip = {
    id: 'text-1',
    kind: 'clip' as const,
    trackId: 'v1',
    clipType: 'text' as const,
    name: 'Text',
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
  };
  const audioTrack = { id: 'a1', kind: 'audio' as const, name: 'Audio', items: [audioClip] };
  const videoTrack = { id: 'v1', kind: 'video' as const, name: 'Video', items: [textClip] };
  const batchApplyTimeline = vi.fn(() => []);

  return {
    track: ref(audioTrack as any),
    item: ref(audioClip as any),
    canEditClipContent: ref(true),
    timelineDoc: ref({
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc-1',
      name: 'Timeline',
      timebase: { fps: 30 },
      tracks: [audioTrack, videoTrack],
    } as any),
    projectSettings: ref({} as any),
    defaultTransitionDurationUs: ref(1_000_000),
    selectedItemIds: ref(selectedItemIds),
    applyTimelineCommand: vi.fn(() => []),
    batchApplyTimeline,
    updateClipProperties: vi.fn(() => []),
    updateClipTransition: vi.fn(() => []),
    requestTimelineSave: vi.fn(async () => {}),
    selectTransition: vi.fn(),
    clearSelection: vi.fn(),
    selectTimelineTransition: vi.fn(),
    emitOpenSpeedModal: vi.fn(),
    emitClipAction: vi.fn(),
    copySelectedClips: vi.fn(),
    cutSelectedClips: vi.fn(),
    pasteClips: vi.fn(),
    hasTimelineClipboard: false,
    requestRenameClip: vi.fn(),
    copyClipParameters: vi.fn(),
    pasteClipParameters: vi.fn(),
    getClipParametersSnapshot: vi.fn(() => null),
    t: (key: string) => key,
  };
}

describe('buildMultiSelectionContextMenu', () => {
  it('shows waveform action for audio-only capable selections', () => {
    const options = createOptions(['audio-1', 'text-1']);

    const groups = buildMultiSelectionContextMenu(options) ?? [];
    const labels = groups.flatMap((group) => group.map((action) => action.label));

    expect(labels).toContain('fastcat.timeline.hideWaveform');
  });

  it('applies waveform visibility only to waveform-capable clips', async () => {
    const options = createOptions(['audio-1', 'text-1']);

    const groups = buildMultiSelectionContextMenu(options) ?? [];
    const waveformAction = groups
      .flat()
      .find((action) => action.label === 'fastcat.timeline.hideWaveform');

    await waveformAction?.onSelect();

    expect(options.batchApplyTimeline).toHaveBeenCalledWith([
      {
        type: 'update_clip_properties',
        trackId: 'a1',
        itemId: 'audio-1',
        properties: { showWaveform: false },
      },
    ]);
  });
});
