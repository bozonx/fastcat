import { defineComponent } from 'vue';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended, mockComponent, mockNuxtImport } from '@nuxt/test-utils/runtime';
import { useTimelineStore } from '~/stores/timeline.store';
import EditorTimeline from '~/components/layout-panels/EditorTimeline.vue';

// Enable E2E bridge so __fastcatE2e* hooks get registered on mount.
mockNuxtImport('useRuntimeConfig', () => () => ({
  public: { e2eTest: true },
}));

mockComponent(
  'UContextMenu',
  defineComponent({ setup: (_, { slots }) => () => (slots.default ? slots.default() : null) }),
);
mockComponent(
  'UDropdownMenu',
  defineComponent({ setup: (_, { slots }) => () => (slots.default ? slots.default() : null) }),
);
mockComponent(
  'UButton',
  defineComponent({
    props: ['icon', 'variant', 'size', 'label', 'class', 'style'],
    emits: ['click'],
    template: '<button :data-icon="icon" @click="$emit(\'click\')">{{ label }}<slot /></button>',
  }),
);

vi.mock('~/composables/timeline/useTimelineSectionResize', async () => {
  const { ref } = await import('vue');
  return {
    useTimelineSectionResize: () => ({
      videoSectionPercent: ref(50),
      sectionContainerRef: ref(null),
      onSectionResizeStart: vi.fn(),
      resetSectionPercent: vi.fn(),
    }),
  };
});

function setupTimelineStore() {
  const timelineStore = useTimelineStore();
  timelineStore.currentTime = 5_000_000;
  timelineStore.timelineZoom = 10;
  timelineStore.timelineDoc = {
    tracks: [
      { id: 'v1', kind: 'video', locked: false, items: [], name: 'Video 1' } as any,
      { id: 'a1', kind: 'audio', locked: false, items: [], name: 'Audio 1' } as any,
    ],
  } as any;
  timelineStore.duration = 10_000_000;
  timelineStore.selectedItemIds = [];
  timelineStore.timelineScrollLeftPx = 0;
  timelineStore.timelineFormat = { width: 1920, height: 1080, fps: 30 } as any;
  timelineStore.splitClipAtPlayhead = vi.fn().mockResolvedValue(undefined);
  timelineStore.selectTimelineItems = vi.fn();
  timelineStore.applyTimeline = vi.fn();
  timelineStore.batchApplyTimeline = vi.fn();
  timelineStore.updateClipProperties = vi.fn();
  timelineStore.updateClipTransition = vi.fn();
  timelineStore.setTimelineZoomExact = vi.fn();
  timelineStore.addTextClipAtPlayhead = vi.fn().mockReturnValue(['text-1']);
  timelineStore.addClipToTimelineFromPath = vi.fn().mockResolvedValue(undefined);
  timelineStore.updateMarker = vi.fn();
  timelineStore.removeMarker = vi.fn();
  timelineStore.getMarkers = vi.fn().mockReturnValue([]);
  timelineStore.saveTimeline = vi.fn().mockResolvedValue(undefined);
  timelineStore.setCurrentTimeUs = vi.fn();
  timelineStore.unlockAllTracks = vi.fn();
  timelineStore.showAllTracks = vi.fn();
  timelineStore.unmuteAllTracks = vi.fn();
  timelineStore.unsoloAllTracks = vi.fn();
  return timelineStore;
}

describe('EditorTimeline — E2E bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear any leftover e2e hooks from previous mount.
    const w = window as any;
    const keys = Object.keys(w).filter((k) => k.startsWith('__fastcatE2e'));
    for (const k of keys) delete w[k];
  });

  it('registers __fastcatE2e* hooks on mount when e2eTest is enabled', async () => {
    setupTimelineStore();
    await mountSuspended(EditorTimeline);

    const w = window as any;
    expect(typeof w.__fastcatE2eSplitClipAtPlayhead).toBe('function');
    expect(typeof w.__fastcatE2eSelectTimelineItems).toBe('function');
    expect(typeof w.__fastcatE2eDeleteSelectedItems).toBe('function');
    expect(typeof w.__fastcatE2eAddMarker).toBe('function');
    expect(typeof w.__fastcatE2eGetTimelineDocInfo).toBe('function');
    expect(typeof w.__fastcatE2eMoveClip).toBe('function');
  });

  it('splitClipAtPlayhead hook calls store method and persists', async () => {
    const timelineStore = setupTimelineStore();
    await mountSuspended(EditorTimeline);

    await (window as any).__fastcatE2eSplitClipAtPlayhead();

    expect(timelineStore.splitClipAtPlayhead).toHaveBeenCalled();
    expect(timelineStore.saveTimeline).toHaveBeenCalled();
  });

  it('selectTimelineItems hook forwards itemIds to store', async () => {
    const timelineStore = setupTimelineStore();
    await mountSuspended(EditorTimeline);

    await (window as any).__fastcatE2eSelectTimelineItems({ itemIds: ['clip-1', 'clip-2'] });

    expect(timelineStore.selectTimelineItems).toHaveBeenCalledWith(['clip-1', 'clip-2']);
  });

  it('setTimelineZoom hook calls setTimelineZoomExact', async () => {
    const timelineStore = setupTimelineStore();
    await mountSuspended(EditorTimeline);

    await (window as any).__fastcatE2eSetTimelineZoom({ zoom: 25 });

    expect(timelineStore.setTimelineZoomExact).toHaveBeenCalledWith(25);
  });

  it('setCurrentTimeUs hook clamps to >= 0', async () => {
    const timelineStore = setupTimelineStore();
    await mountSuspended(EditorTimeline);

    await (window as any).__fastcatE2eSetCurrentTimeUs({ us: -100 });

    expect(timelineStore.setCurrentTimeUs).toHaveBeenCalledWith(0);
  });

  it('getSelectedItemIds hook returns selected ids', async () => {
    const timelineStore = setupTimelineStore();
    timelineStore.selectedItemIds = ['a', 'b'];
    await mountSuspended(EditorTimeline);

    const result = await (window as any).__fastcatE2eGetSelectedItemIds();

    expect(result).toEqual(['a', 'b']);
  });

  it('addTextClip hook calls addTextClipAtPlayhead and persists', async () => {
    const timelineStore = setupTimelineStore();
    await mountSuspended(EditorTimeline);

    const result = await (window as any).__fastcatE2eAddTextClip({ text: 'Hi', style: {}, durationUs: 1_000_000 });

    expect(timelineStore.addTextClipAtPlayhead).toHaveBeenCalled();
    expect(result).toEqual(['text-1']);
    expect(timelineStore.saveTimeline).toHaveBeenCalled();
  });

  it('addMarker hook dispatches applyTimeline with marker id', async () => {
    const timelineStore = setupTimelineStore();
    await mountSuspended(EditorTimeline);

    const id = await (window as any).__fastcatE2eAddMarker({ timeUs: 1_000_000, text: 'M', color: '#fff' });

    expect(id).toBeTruthy();
    expect(timelineStore.applyTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'add_marker', timeUs: 1_000_000, text: 'M', color: '#fff', id }),
    );
  });

  it('addMarkers hook dispatches batchApplyTimeline', async () => {
    const timelineStore = setupTimelineStore();
    await mountSuspended(EditorTimeline);

    const ids = await (window as any).__fastcatE2eAddMarkers({
      markers: [
        { timeUs: 1_000_000, text: 'M1', color: '#fff' },
        { timeUs: 2_000_000, text: 'M2', color: '#000' },
      ],
    });

    expect(ids.length).toBe(2);
    expect(timelineStore.batchApplyTimeline).toHaveBeenCalled();
    expect(timelineStore.batchApplyTimeline.mock.calls[0][0].length).toBe(2);
  });

  it('updateMarker hook forwards patch to store', async () => {
    const timelineStore = setupTimelineStore();
    await mountSuspended(EditorTimeline);

    await (window as any).__fastcatE2eUpdateMarker({ markerId: 'mk-1', patch: { text: 'updated' } });

    expect(timelineStore.updateMarker).toHaveBeenCalledWith('mk-1', { text: 'updated' });
  });

  it('removeMarker hook forwards id to store', async () => {
    const timelineStore = setupTimelineStore();
    await mountSuspended(EditorTimeline);

    await (window as any).__fastcatE2eRemoveMarker({ markerId: 'mk-1' });

    expect(timelineStore.removeMarker).toHaveBeenCalledWith('mk-1');
  });

  it('getMarkers hook forwards to store', async () => {
    const timelineStore = setupTimelineStore();
    timelineStore.getMarkers = vi.fn().mockReturnValue([{ id: 'mk-1' }]);
    await mountSuspended(EditorTimeline);

    const result = await (window as any).__fastcatE2eGetMarkers();

    expect(result).toEqual([{ id: 'mk-1' }]);
  });

  it('getTimelineDocInfo hook returns duration, trackCount and tracks summary', async () => {
    const timelineStore = setupTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [{ id: 'v1', kind: 'video', videoHidden: false, items: [] } as any],
    } as any;
    await mountSuspended(EditorTimeline);

    const info = (window as any).__fastcatE2eGetTimelineDocInfo();

    expect(info.trackCount).toBe(1);
    expect(info.tracks[0]).toMatchObject({ id: 'v1', kind: 'video', clipCount: 0 });
  });

  it('addProjectFileToTrack hook resolves name from path and adds clip', async () => {
    const timelineStore = setupTimelineStore();
    await mountSuspended(EditorTimeline);

    await (window as any).__fastcatE2eAddProjectFileToTrack({ path: '/media/clip.mp4', trackId: 'v1' });

    expect(timelineStore.addClipToTimelineFromPath).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/media/clip.mp4', trackId: 'v1', name: 'clip.mp4', startUs: 0 }),
    );
  });

  it('moveClip hook throws when track not found', async () => {
    setupTimelineStore();
    await mountSuspended(EditorTimeline);

    await expect(
      (window as any).__fastcatE2eMoveClip({ itemId: 'missing', deltaUs: 1_000_000 }),
    ).rejects.toThrow('Timeline clip track not found: missing');
  });

  it('saveTimeline hook persists the doc', async () => {
    const timelineStore = setupTimelineStore();
    await mountSuspended(EditorTimeline);

    await (window as any).__fastcatE2eSaveTimeline();

    expect(timelineStore.saveTimeline).toHaveBeenCalled();
  });
});

describe('EditorTimeline — track reset buttons', () => {
  it('renders muted reset button when a track is muted and calls unmuteAllTracks', async () => {
    const timelineStore = setupTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [{ id: 'a1', kind: 'audio', audioMuted: true, items: [] } as any],
    } as any;
    const component = await mountSuspended(EditorTimeline);

    const muteBtn = component.find('button[data-icon="i-heroicons-speaker-x-mark"]');
    expect(muteBtn.exists()).toBe(true);
    await muteBtn.trigger('click');

    expect(timelineStore.unmuteAllTracks).toHaveBeenCalled();
  });

  it('renders hidden reset button when a track is hidden and calls showAllTracks', async () => {
    const timelineStore = setupTimelineStore();
    timelineStore.timelineDoc = {
      tracks: [{ id: 'v1', kind: 'video', videoHidden: true, items: [] } as any],
    } as any;
    const component = await mountSuspended(EditorTimeline);

    const hiddenBtn = component.find('button[data-icon="i-heroicons-eye-slash"]');
    expect(hiddenBtn.exists()).toBe(true);
    await hiddenBtn.trigger('click');

    expect(timelineStore.showAllTracks).toHaveBeenCalled();
  });
});
