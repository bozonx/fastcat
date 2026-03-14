import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useClipPropertiesActions } from '../../../src/composables/properties/useClipPropertiesActions';
import type { TimelineClipItem, TrackKind } from '../../../src/timeline/types';
import { quantizeTimeUsToFrames, sanitizeFps } from '../../../src/timeline/commands/utils';

function makeClip(partial: Partial<TimelineClipItem> = {}): TimelineClipItem {
  return {
    kind: 'clip',
    clipType: 'media',
    id: 'c1',
    trackId: 'v1',
    name: 'Clip 1',
    timelineRange: { startUs: 101_000, durationUs: 1_033_000 },
    sourceRange: { startUs: 0, durationUs: 1_033_000 },
    source: { path: 'a.mp4' },
    sourceDurationUs: 10_000_000,
    ...partial,
  } as TimelineClipItem;
}

function createOptions(clip: TimelineClipItem) {
  const appliedCommands: unknown[] = [];
  const timelineStore = {
    timelineDoc: {
      OTIO_SCHEMA: 'Timeline.1',
      id: 'doc-1',
      name: 'Test',
      timebase: { fps: 30 },
      tracks: [],
    },
    selectedItemIds: ['c1', 'c2'],
    applyTimeline: vi.fn((command: unknown) => {
      appliedCommands.push(command);
    }),
    updateClipProperties: vi.fn(),
    batchApplyTimeline: vi.fn(),
    renameItem: vi.fn(),
  };

  const options = {
    clip: ref(clip),
    trackKind: ref<TrackKind>('video'),
    timelineStore,
    projectStore: { currentView: 'cut' },
    uiStore: { selectedFsEntry: null },
    editorViewStore: { goToFiles: vi.fn() },
    filesPageStore: { selectFolder: vi.fn() },
    selectionStore: { selectFsEntry: vi.fn() },
    focusStore: { setTempFocus: vi.fn() },
    fileManager: {
      loadProjectDirectory: vi.fn(),
      findEntryByPath: vi.fn(),
      toggleDirectory: vi.fn(),
    },
    setActiveTab: vi.fn(),
  };

  return {
    api: useClipPropertiesActions(options),
    timelineStore,
    appliedCommands,
  };
}

describe('useClipPropertiesActions', () => {
  it('deletes only the current clip from properties actions', () => {
    const { api, timelineStore } = createOptions(makeClip({ id: 'c1' }));

    api.handleDeleteClip();

    expect(timelineStore.applyTimeline).toHaveBeenCalledWith({
      type: 'delete_items',
      trackId: 'v1',
      itemIds: ['c1'],
    });
    expect(timelineStore.selectedItemIds).toEqual(['c2']);
  });

  it('quantizes clip start and duration via move and trim commands', () => {
    const clip = makeClip({
      timelineRange: { startUs: 101_000, durationUs: 1_033_000 },
    });
    const { api, appliedCommands, timelineStore } = createOptions(clip);

    api.handleQuantizeClip();

    expect(timelineStore.applyTimeline).toHaveBeenCalledTimes(2);

    const fps = sanitizeFps(timelineStore.timelineDoc.timebase.fps);
    const expectedStartUs = quantizeTimeUsToFrames(clip.timelineRange.startUs, fps, 'round');
    const expectedEndUs = quantizeTimeUsToFrames(
      clip.timelineRange.startUs + clip.timelineRange.durationUs,
      fps,
      'round',
    );
    const expectedDurationUs = Math.max(1, expectedEndUs - expectedStartUs);

    expect(appliedCommands[0]).toEqual({
      type: 'move_item',
      trackId: clip.trackId,
      itemId: clip.id,
      startUs: expectedStartUs,
      quantizeToFrames: false,
    });
    expect(appliedCommands[1]).toEqual({
      type: 'trim_item',
      trackId: clip.trackId,
      itemId: clip.id,
      edge: 'end',
      deltaUs: expectedDurationUs - clip.timelineRange.durationUs,
      quantizeToFrames: false,
    });
  });
});
