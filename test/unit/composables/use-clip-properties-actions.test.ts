import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useClipPropertiesActions } from '../../../src/composables/properties/useClipPropertiesActions';
import type { TimelineClipItem, TrackKind } from '../../../src/timeline/types';
import type { FsEntry } from '../../../src/types/fs';
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
    fps: 30,
    applyTimeline: vi.fn((command: unknown) => {
      appliedCommands.push(command);
    }),
    updateClipProperties: vi.fn(),
    batchApplyTimeline: vi.fn(),
    loadTimeline: vi.fn(),
    loadTimelineMetadata: vi.fn(),
    renameItem: vi.fn(),
  };

  const projectStore = {
    currentView: 'cut',
    openTimelineFile: vi.fn(),
  };
  const uiStore = { selectedFsEntry: null as Partial<FsEntry> | null };
  const editorViewStore = { goToFiles: vi.fn(), goToCut: vi.fn() };
  const filesPageStore = { selectFolder: vi.fn() };
  const selectionStore = { selectFsEntry: vi.fn() };
  const focusStore = { setTempFocus: vi.fn() };
  const fileManager = {
    loadProjectDirectory: vi.fn(),
    findEntryByPath: vi.fn(),
    toggleDirectory: vi.fn(),
  };
  const setActiveTab = vi.fn();

  const options = {
    clip: ref(clip),
    trackKind: ref<TrackKind>('video'),
    timelineStore,
    projectStore,
    uiStore,
    editorViewStore,
    filesPageStore,
    selectionStore,
    focusStore,
    fileManager,
    setActiveTab,
  };

  return {
    api: useClipPropertiesActions(options),
    timelineStore,
    appliedCommands,
    projectStore,
    uiStore,
    editorViewStore,
    filesPageStore,
    selectionStore,
    focusStore,
    fileManager,
    setActiveTab,
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

  it('opens parent folder but keeps the file selected in file manager', async () => {
    const clip = makeClip({ source: { path: ' media / nested / clip.mp4 ' } });
    const { api, fileManager, filesPageStore, selectionStore, uiStore, setActiveTab, focusStore } =
      createOptions(clip);

    const parentEntry = {
      kind: 'directory',
      name: 'nested',
      path: 'media/nested',
    };
    const fileEntry = {
      kind: 'file',
      name: 'clip.mp4',
      path: 'media/nested/clip.mp4',
      parentPath: 'media/nested',
      lastModified: 1,
      size: 100,
      source: 'local',
    };

    vi.mocked(fileManager.findEntryByPath).mockImplementation((path: string) => {
      if (path === 'media') {
        return {
          kind: 'directory',
          name: 'media',
          path: 'media',
          expanded: true,
        } as any;
      }
      if (path === 'media/nested') {
        return parentEntry as any;
      }
      if (path === 'media/nested/clip.mp4') {
        return fileEntry as any;
      }
      return null;
    });

    await api.handleSelectInFileManager();

    expect(setActiveTab).toHaveBeenCalledWith('files');
    expect(filesPageStore.selectFolder).toHaveBeenCalledWith(parentEntry);
    expect(selectionStore.selectFsEntry).toHaveBeenCalledWith(fileEntry);
    expect(uiStore.selectedFsEntry).toEqual({
      kind: 'file',
      name: 'clip.mp4',
      path: 'media/nested/clip.mp4',
      parentPath: 'media/nested',
      lastModified: 1,
      size: 100,
      source: 'local',
      remoteId: undefined,
      remotePath: undefined,
      remoteData: undefined,
    });
    expect(focusStore.setTempFocus).toHaveBeenCalledWith('left');
  });

  it('opens nested timeline using full file-manager flow', async () => {
    const clip = makeClip({
      clipType: 'timeline',
      source: { path: ' timelines / nested_001.otio ' },
    });
    const { api, projectStore, timelineStore, editorViewStore } = createOptions(clip);

    await api.handleOpenNestedTimeline();

    expect(projectStore.openTimelineFile).toHaveBeenCalledWith('timelines/nested_001.otio');
    expect(timelineStore.loadTimeline).toHaveBeenCalledTimes(1);
    expect(timelineStore.loadTimelineMetadata).toHaveBeenCalledTimes(1);
    expect(editorViewStore.goToCut).toHaveBeenCalledTimes(1);
  });
});
