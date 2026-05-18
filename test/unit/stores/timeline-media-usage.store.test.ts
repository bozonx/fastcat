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

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => projectStoreMock),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => workspaceStoreMock),
}));

vi.mock('~/composables/useVfs', () => ({
  useVfs: vi.fn(() => null),
}));

vi.mock('~/timeline/otio-serializer', () => ({
  parseTimelineFromOtio: vi.fn((text: string) => ({ name: text, tracks: [] })),
}));

vi.mock('~/timeline/id', () => ({
  createTimelineDocId: vi.fn(() => 'doc-1'),
}));

vi.mock('~/utils/timeline-media-usage', () => ({
  computeMediaUsageByTimelineDocs: vi.fn(() => ({ mediaPathToTimelines: {} })),
}));

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

});
