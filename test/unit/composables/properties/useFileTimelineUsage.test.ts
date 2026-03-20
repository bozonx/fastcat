import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { useFileTimelineUsage } from '../~/composables/properties/useFileTimelineUsage';

describe('useFileTimelineUsage', () => {
  it('returns empty usage when entry is not a file or has no path', () => {
    const api1 = useFileTimelineUsage({
      selectedFsEntry: ref({ kind: 'directory', path: '/x' }),
      timelineMediaUsageStore: { mediaPathToTimelines: {} },
      projectStore: { openTimelineFile: vi.fn().mockResolvedValue(undefined) },
      timelineStore: {
        loadTimeline: vi.fn().mockResolvedValue(undefined),
        loadTimelineMetadata: vi.fn().mockResolvedValue(undefined),
      },
    });
    expect(api1.timelinesUsingSelectedFile.value).toEqual([]);

    const api2 = useFileTimelineUsage({
      selectedFsEntry: ref({ kind: 'file' }),
      timelineMediaUsageStore: { mediaPathToTimelines: {} },
      projectStore: { openTimelineFile: vi.fn().mockResolvedValue(undefined) },
      timelineStore: {
        loadTimeline: vi.fn().mockResolvedValue(undefined),
        loadTimelineMetadata: vi.fn().mockResolvedValue(undefined),
      },
    });
    expect(api2.timelinesUsingSelectedFile.value).toEqual([]);
  });

  it('openTimelineFromUsage calls stores in order', async () => {
    const projectStore = { openTimelineFile: vi.fn().mockResolvedValue(undefined) };
    const timelineStore = {
      loadTimeline: vi.fn().mockResolvedValue(undefined),
      loadTimelineMetadata: vi.fn().mockResolvedValue(undefined),
    };

    const api = useFileTimelineUsage({
      selectedFsEntry: ref({ kind: 'file', path: '/a.mp4' }),
      timelineMediaUsageStore: { mediaPathToTimelines: { '/a.mp4': [{ timelinePath: 't1' }] } },
      projectStore,
      timelineStore,
    });

    await api.openTimelineFromUsage('t1');

    expect(projectStore.openTimelineFile).toHaveBeenCalledWith('t1');
    expect(timelineStore.loadTimeline).toHaveBeenCalled();
    expect(timelineStore.loadTimelineMetadata).toHaveBeenCalled();
  });
});
