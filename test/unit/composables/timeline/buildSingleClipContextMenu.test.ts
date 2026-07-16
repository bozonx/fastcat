import { ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import {
  buildSingleClipMainGroup,
  buildSingleItemActionGroup,
} from '~/composables/timeline/clip-context-menu/buildSingleClipContextMenu';
import type { UseClipContextMenuOptions } from '~/composables/timeline/clip-context-menu/types';

function createOptions(
  overrides: Partial<UseClipContextMenuOptions> = {},
): UseClipContextMenuOptions {
  const track = {
    id: 'track-1',
    kind: 'video' as const,
    locked: false,
    items: [],
  };
  const item = {
    id: 'clip-1',
    kind: 'clip' as const,
    trackId: 'track-1',
    clipType: 'media' as const,
    name: 'Clip 1',
    timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
    sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
    sourceDurationTicks: 5_000_000,
    showWaveform: true,
  };

  return {
    track: ref(track),
    item: ref(item),
    canEditClipContent: ref(true),
    timelineDoc: ref({ tracks: [track], timebase: { fps: 30 } } as any),
    projectSettings: ref({} as any),
    defaultTransitionDurationTicks: ref(1_000_000),
    selectedItemIds: ref(['clip-1']),
    currentTime: ref(0),
    applyTimelineCommand: vi.fn(() => []),
    batchApplyTimeline: vi.fn(() => []),
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
    ...overrides,
  };
}

describe('buildSingleClipContextMenu', () => {
  it('uses explicit waveform actions and exposes waveform visibility toggle', () => {
    const options = createOptions();

    const labels = buildSingleClipMainGroup(options).flatMap((group) =>
      group.map((action) => action.label),
    );

    expect(labels).toContain('fastcat.timeline.showFullWaveform');
    expect(labels).toContain('fastcat.timeline.hideWaveform');
  });

  it('does not expose speed for image clips', () => {
    const options = createOptions({
      item: ref({
        id: 'clip-1',
        kind: 'clip',
        trackId: 'track-1',
        clipType: 'media',
        name: 'Image 1',
        timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
        sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
        sourceDurationTicks: 5_000_000,
        isImage: true,
      } as any),
    });

    const labels = buildSingleClipMainGroup(options).flatMap((group) =>
      group.map((action) => action.label),
    );

    expect(labels.some((label) => label.startsWith('fastcat.timeline.speed'))).toBe(false);
  });

  it('does not expose reverse for audio clips', () => {
    const options = createOptions({
      track: ref({
        id: 'track-1',
        kind: 'audio',
        locked: false,
        items: [],
      }),
      item: ref({
        id: 'clip-1',
        kind: 'clip',
        trackId: 'track-1',
        clipType: 'media',
        name: 'Audio 1',
        timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
        sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
        sourceDurationTicks: 5_000_000,
        showWaveform: true,
      } as any),
    });

    const labels = buildSingleClipMainGroup(options).flatMap((group) =>
      group.map((action) => action.label),
    );

    expect(labels.some((label) => label.startsWith('fastcat.timeline.speed'))).toBe(true);
    expect(labels).not.toContain('videoEditor.audio.reverse');
  });

  it('does not expose audio controls for text clips', () => {
    const options = createOptions({
      item: ref({
        id: 'clip-1',
        kind: 'clip',
        trackId: 'track-1',
        clipType: 'text',
        name: 'Text 1',
        timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
        sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
      } as any),
    });

    const labels = buildSingleClipMainGroup(options).flatMap((group) =>
      group.map((action) => action.label),
    );

    expect(labels).not.toContain('fastcat.timeline.muteClip');
    expect(labels).not.toContain('fastcat.timeline.showWaveform');
    expect(labels).not.toContain('fastcat.timeline.showFullWaveform');
  });

  it('adds rename action for a single clip', () => {
    const options = createOptions();

    const actions = buildSingleItemActionGroup(options);
    const renameAction = actions.find((action) => action.label === 'common.rename');

    expect(renameAction).toBeTruthy();
    renameAction?.onSelect();

    expect(options.requestRenameClip).toHaveBeenCalledWith({
      trackId: 'track-1',
      itemId: 'clip-1',
      name: 'Clip 1',
    });
  });

  it('correctly orders groups in buildSingleClipMainGroup (speedGroup first)', () => {
    const options = createOptions();
    const groups = buildSingleClipMainGroup(options);

    const speedGroupLabels = groups[0].map((action) => action.label);
    expect(speedGroupLabels[0]).toContain('fastcat.timeline.speed');
    expect(speedGroupLabels[1]).toBe('videoEditor.audio.reverse');
    expect(speedGroupLabels[2]).toBe('fastcat.timeline.freezeFrame');
  });

  it('disables freezeFrame action when playhead is outside the clip', () => {
    const options = createOptions({
      item: ref({
        id: 'clip-1',
        kind: 'clip',
        trackId: 'track-1',
        clipType: 'media',
        name: 'Clip 1',
        timelineRange: { startTicks: 1_000_000, durationTicks: 5_000_000 },
        sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
        sourceDurationTicks: 5_000_000,
      } as any),
      currentTime: ref(500_000),
    });

    const groups = buildSingleClipMainGroup(options);
    const speedGroup = groups[0];
    const freezeAction = speedGroup.find(
      (action) => action.label === 'fastcat.timeline.freezeFrame',
    );
    expect(freezeAction?.disabled).toBe(true);
  });

  it('disables speed and reverse actions when freeze frame is active', () => {
    const options = createOptions({
      item: ref({
        id: 'clip-1',
        kind: 'clip',
        trackId: 'track-1',
        clipType: 'media',
        name: 'Clip 1',
        timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
        sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
        sourceDurationTicks: 5_000_000,
        freezeFrameSourceTicks: 2_000_000,
      } as any),
    });

    const groups = buildSingleClipMainGroup(options);
    const speedGroup = groups[0];
    const speedAction = speedGroup.find((action) =>
      action.label.startsWith('fastcat.timeline.speed'),
    );
    const reverseAction = speedGroup.find((action) => action.label === 'videoEditor.audio.reverse');

    expect(speedAction?.disabled).toBe(true);
    expect(reverseAction?.disabled).toBe(true);
  });
});
