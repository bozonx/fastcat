import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nextTick, reactive } from 'vue';
import { mountWithNuxt } from '../../utils/mount';
import MarkerThumbnail from '~/components/project/MarkerThumbnail.vue';
import type { MarkerThumbnailParams } from '~/timeline/services/marker-thumbnail.service';

const mockTimelineStore = reactive({ timelineDoc: { tracks: [] } as any });
const mockProjectStore = reactive({ currentProjectId: 'project-1' as string | null });
const mockWorkspaceStore = reactive({ hasPersistentStorage: true });

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));
vi.mock('~/stores/project.store', () => ({ useProjectStore: () => mockProjectStore }));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => mockWorkspaceStore }));

const getMarkerThumbnailMock = vi.hoisted(() => vi.fn());
vi.mock('~/utils/file-thumbnail-generator', () => ({
  fileThumbnailGenerator: { getMarkerThumbnail: getMarkerThumbnailMock },
}));

// Capture each dispatch so the test can resolve them out of order.
const dispatches: MarkerThumbnailParams[] = [];
vi.mock('~/timeline/services/marker-thumbnail.service', () => ({
  dispatchMarkerThumbnailGeneration: (params: MarkerThumbnailParams) => {
    dispatches.push(params);
  },
}));

describe('MarkerThumbnail.vue stale-result guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatches.length = 0;
    getMarkerThumbnailMock.mockResolvedValue(null); // force a generation dispatch
    mockProjectStore.currentProjectId = 'project-1';
    mockWorkspaceStore.hasPersistentStorage = true;
  });

  it('ignores an in-flight generation for a previous time once the marker moves', async () => {
    const component = await mountWithNuxt(MarkerThumbnail, {
      props: { markerId: 'marker-1', timeUs: 1_000_000 },
    });
    // Let the initial async cache-miss → dispatch settle.
    await vi.waitFor(() => expect(dispatches).toHaveLength(1));

    // Marker moves before the first generation completes.
    await component.setProps({ timeUs: 2_000_000 });
    await vi.waitFor(() => expect(dispatches).toHaveLength(2));

    // Completion order is the crux of the race: the CURRENT generation resolves
    // first, then the STALE one for the previous time resolves last. Without the
    // load-token guard the late stale result would clobber the current frame.
    dispatches[1].onComplete?.('blob:current-frame');
    dispatches[0].onComplete?.('blob:stale-frame');
    await nextTick();

    const img = component.find('img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toBe('blob:current-frame');
  });
});
