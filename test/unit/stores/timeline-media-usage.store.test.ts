/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { reactive } from 'vue';
import { useTimelineMediaUsageStore } from '~/stores/timeline-media-usage.store';

const projectStoreMock = reactive({
  currentProjectName: 'test-project',
  projectSettings: { project: { width: 1920, height: 1080, fps: 30 } },
});

const workspaceStoreMock = reactive({
  projectsHandle: { getDirectoryHandle: vi.fn() } as any,
});

const { mockGetFile, mockReadDirectory, parseTimelineFromOtioMock } = vi.hoisted(() => ({
  mockGetFile: vi.fn(),
  mockReadDirectory: vi.fn(),
  parseTimelineFromOtioMock: vi.fn((text: string) => ({
    name: text,
    tracks: [{ id: 'v1', kind: 'video', items: [{ id: 'clip-1', kind: 'clip' }] }],
  })),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => projectStoreMock),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => workspaceStoreMock),
}));

vi.mock('~/composables/useVfs', () => ({
  useVfs: vi.fn(() => ({ getFile: mockGetFile, readDirectory: mockReadDirectory })),
}));

vi.mock('~/timeline/otio-serializer', () => ({
  parseTimelineFromOtio: parseTimelineFromOtioMock,
}));

vi.mock('~/timeline/id', () => ({
  createTimelineDocId: vi.fn(() => 'doc-1'),
}));

vi.mock('~/utils/timeline-media-usage', () => ({
  computeMediaUsageByTimelineDocs: vi.fn(() => ({ mediaPathToTimelines: {} })),
}));

/**
 * Build a `readDirectory(path)` mock from a nested tree. The store walks the
 * active project root ('') recursively; each directory maps to its VfsEntry[].
 */
function buildReadDirectory(
  tree: Record<string, Array<{ name: string; kind: 'file' | 'directory' }>>,
) {
  return vi.fn(async (dirPath: string) => {
    const entries = tree[dirPath] ?? [];
    return entries.map((e) => ({
      name: e.name,
      kind: e.kind,
      path: dirPath ? `${dirPath}/${e.name}` : e.name,
    }));
  });
}

describe('TimelineMediaUsageStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    projectStoreMock.currentProjectName = 'test-project';
    workspaceStoreMock.projectsHandle = { getDirectoryHandle: vi.fn() };
  });

  it('mediaPathToTimelines combines scanned and live usage', () => {
    const store = useTimelineMediaUsageStore();
    store.setLiveUsage('timeline1.otio', {
      'video/a.mp4': [{ timelinePath: 'timeline1.otio', timelineName: 'Timeline 1' }],
    });

    expect(store.mediaPathToTimelines['video/a.mp4']).toBeDefined();
    expect(store.mediaPathToTimelines['video/a.mp4']).toHaveLength(1);
  });

  it('mediaPathToTimelines removes stale scanned data for current timeline', () => {
    const store = useTimelineMediaUsageStore();
    // scanned data contains a reference to the same timeline
    store.scannedMediaUsage = {
      'video/a.mp4': [{ timelinePath: 'timeline1.otio', timelineName: 'Old' }],
    };
    store.setLiveUsage('timeline1.otio', {
      'video/a.mp4': [{ timelinePath: 'timeline1.otio', timelineName: 'Live' }],
    });

    const refs = store.mediaPathToTimelines['video/a.mp4'];
    expect(refs).toHaveLength(1);
    expect(refs[0].timelineName).toBe('Live');
  });

  it('skips .fastcat directory when scanning timelines', async () => {
    mockReadDirectory.mockImplementation(
      buildReadDirectory({
        '': [
          { name: 'timeline1.otio', kind: 'file' },
          { name: '.fastcat', kind: 'directory' },
          { name: 'subfolder', kind: 'directory' },
        ],
        subfolder: [{ name: 'timeline2.otio', kind: 'file' }],
      }),
    );

    mockGetFile.mockImplementation((path: string) => {
      if (path.endsWith('.otio')) {
        return Promise.resolve({
          text: () => Promise.resolve(JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', name: path })),
        } as unknown as File);
      }
      return Promise.resolve(null);
    });

    const store = useTimelineMediaUsageStore();
    await store.refreshUsage();

    expect(mockGetFile).toHaveBeenCalledWith('timeline1.otio');
    expect(mockGetFile).toHaveBeenCalledWith('subfolder/timeline2.otio');
    expect(mockGetFile).not.toHaveBeenCalledWith('.fastcat/autosave/timeline1.otio');
    expect(parseTimelineFromOtioMock).toHaveBeenCalledWith(expect.any(String), expect.any(Object), {
      logWarnings: false,
    });
  });

  it('skips empty or invalid timelines during background media usage scan', async () => {
    mockReadDirectory.mockImplementation(
      buildReadDirectory({ '': [{ name: 'broken.otio', kind: 'file' }] }),
    );
    mockGetFile.mockResolvedValue({
      text: () => Promise.resolve(JSON.stringify({ OTIO_SCHEMA: 'Timeline.1', name: 'broken' })),
    } as unknown as File);
    parseTimelineFromOtioMock.mockReturnValueOnce({
      name: 'broken',
      tracks: [{ id: 'v1', kind: 'video', items: [] }],
    });

    const store = useTimelineMediaUsageStore();
    await store.refreshUsage();

    expect(store.mediaPathToTimelines).toEqual({});
  });
});
