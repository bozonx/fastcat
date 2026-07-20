import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { buildMultiSelectionContextMenu } from '~/composables/timeline/clip-context-menu/buildMultiSelectionContextMenu';
import type { UseClipContextMenuOptions } from '~/composables/timeline/clip-context-menu/types';

const mockWorkspaceStore = {
  inDevelopmentFeaturesEnabled: false,
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

function createOptions(selectedItemIds: string[]): UseClipContextMenuOptions {
  const audioClip = {
    id: 'audio-1',
    kind: 'clip' as const,
    trackId: 'a1',
    clipType: 'media' as const,
    name: 'Audio',
    timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
    sourceDurationTicks: 5_000_000,
  };
  const textClip = {
    id: 'text-1',
    kind: 'clip' as const,
    trackId: 'v1',
    clipType: 'text' as const,
    name: 'Text',
    timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
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
    defaultTransitionDurationTicks: ref(1_000_000),
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
    getHotkeyKbds: vi.fn(() => undefined),
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

  it('shows lock option when clips are unlocked', () => {
    const options = createOptions(['audio-1', 'text-1']);

    const groups = buildMultiSelectionContextMenu(options) ?? [];
    const labels = groups.flatMap((group) => group.map((action) => action.label));

    expect(labels).toContain('fastcat.timeline.lockClips');
    expect(labels).not.toContain('fastcat.timeline.unlockClips');
  });

  it('shows unlock option when clips are locked', () => {
    const options = createOptions(['audio-1', 'text-1']);
    for (const track of options.timelineDoc.value.tracks) {
      for (const item of track.items) {
        item.locked = true;
      }
    }

    const groups = buildMultiSelectionContextMenu(options) ?? [];
    const labels = groups.flatMap((group) => group.map((action) => action.label));

    expect(labels).toContain('fastcat.timeline.unlockClips');
    expect(labels).not.toContain('fastcat.timeline.lockClips');
  });

  it('applies lock/unlock to all selected items when selected', async () => {
    const options = createOptions(['audio-1', 'text-1']);

    const groups = buildMultiSelectionContextMenu(options) ?? [];
    const lockAction = groups
      .flat()
      .find((action) => action.label === 'fastcat.timeline.lockClips');

    await lockAction?.onSelect();

    expect(options.batchApplyTimeline).toHaveBeenCalledWith([
      {
        type: 'update_clip_properties',
        trackId: 'a1',
        itemId: 'audio-1',
        properties: { locked: true },
      },
      {
        type: 'update_clip_properties',
        trackId: 'v1',
        itemId: 'text-1',
        properties: { locked: true },
      },
    ]);
  });

  describe('paste parameters action (in-development feature)', () => {
    it('hides paste parameters when in-development features are disabled', () => {
      mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;

      const options = createOptions(['audio-1', 'text-1']);
      options.getClipParametersSnapshot = vi.fn(() => ({}) as any);

      const labels = (buildMultiSelectionContextMenu(options) ?? []).flatMap((group) =>
        group.map((action) => action.label),
      );

      expect(labels).not.toContain('fastcat.clip.parameters.paste');
    });

    it('shows paste parameters when enabled and a snapshot is on the clipboard', () => {
      mockWorkspaceStore.inDevelopmentFeaturesEnabled = true;

      const options = createOptions(['audio-1', 'text-1']);
      options.getClipParametersSnapshot = vi.fn(() => ({}) as any);

      const labels = (buildMultiSelectionContextMenu(options) ?? []).flatMap((group) =>
        group.map((action) => action.label),
      );

      expect(labels).toContain('fastcat.clip.parameters.paste');
    });
  });
});
