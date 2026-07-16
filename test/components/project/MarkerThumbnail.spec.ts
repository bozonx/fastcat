import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

// Deterministic, per-blob object URLs so ownership and revocation are observable.
const urlForBlob = new Map<Blob, string>();
let urlSeq = 0;
const revoked: string[] = [];

describe('MarkerThumbnail.vue URL ownership + stale-result guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatches.length = 0;
    urlForBlob.clear();
    urlSeq = 0;
    revoked.length = 0;
    getMarkerThumbnailMock.mockResolvedValue(null); // force a generation dispatch
    mockProjectStore.currentProjectId = 'project-1';
    mockWorkspaceStore.hasPersistentStorage = true;

    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob | MediaSource) => {
      const url = `blob:marker-${++urlSeq}`;
      urlForBlob.set(blob as Blob, url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
      revoked.push(url);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('mints its own URL from the blob and ignores a stale generation after the marker moves', async () => {
    const component = await mountWithNuxt(MarkerThumbnail, {
      props: { markerId: 'marker-1', timeTicks: 1_000_000 },
    });
    await vi.waitFor(() => expect(dispatches).toHaveLength(1));

    // Marker moves before the first generation completes.
    await component.setProps({ timeTicks: 2_000_000 });
    await vi.waitFor(() => expect(dispatches).toHaveLength(2));

    const currentBlob = new Blob(['current'], { type: 'image/webp' });
    const staleBlob = new Blob(['stale'], { type: 'image/webp' });

    // The CURRENT generation resolves first, then the STALE one resolves last.
    dispatches[1].onComplete?.(currentBlob);
    dispatches[0].onComplete?.(staleBlob);
    await nextTick();

    const img = component.find('img');
    expect(img.exists()).toBe(true);
    // Shows the current frame's own URL; the stale blob never got a URL created.
    expect(img.attributes('src')).toBe(urlForBlob.get(currentBlob));
    expect(urlForBlob.has(staleBlob)).toBe(false);
  });

  it('revokes its owned URL on unmount', async () => {
    const component = await mountWithNuxt(MarkerThumbnail, {
      props: { markerId: 'marker-1', timeTicks: 1_000_000 },
    });
    await vi.waitFor(() => expect(dispatches).toHaveLength(1));

    const blob = new Blob(['frame'], { type: 'image/webp' });
    dispatches[0].onComplete?.(blob);
    await nextTick();

    const ownUrl = urlForBlob.get(blob)!;
    expect(component.find('img').attributes('src')).toBe(ownUrl);

    component.unmount();
    expect(revoked).toContain(ownUrl);
  });
});
