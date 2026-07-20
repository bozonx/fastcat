/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { defineComponent, h, ref, reactive } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';
import { useTimelineClickActions } from '~/composables/timeline/useTimelineClickActions';
import type { TimelineTrack } from '~/timeline/types';

const resetTimelineZoomMock = vi.fn();
const fitTimelineZoomMock = vi.fn();
const requestCenterPlayheadMock = vi.fn();
const setCurrentTimeTicksMock = vi.fn();
const applyTimelineMock = vi.fn();
const selectTimelinePropertiesMock = vi.fn();

const timelineStoreMock = {
  duration: 10 * 254_016_000_000,
  currentTime: 0,
  timelineZoom: 50,
  markers: [],
  selectionRange: null,
  isTrimModeActive: false,
  timelineFormat: { fps: 25 },
  resetTimelineZoom: resetTimelineZoomMock,
  fitTimelineZoom: fitTimelineZoomMock,
  requestCenterPlayhead: requestCenterPlayheadMock,
  setCurrentTimeTicks: setCurrentTimeTicksMock,
  applyTimeline: applyTimelineMock,
  selectTimelineProperties: selectTimelinePropertiesMock,
};

const timelineSettingsStoreMock = {
  toolbarSnapMode: 'snap' as const,
};

const mockWorkspaceStore = {
  userSettings: reactive(JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS))),
};

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => timelineStoreMock,
}));

vi.mock('~/stores/timeline-settings.store', () => ({
  useTimelineSettingsStore: () => timelineSettingsStoreMock,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

vi.mock('~/composables/timeline/timeline-drag-domain', () => ({
  resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
}));

let activeWrapper: VueWrapper | null = null;

function setup({
  videoTracks = [] as TimelineTrack[],
  audioTracks = [] as TimelineTrack[],
}: { videoTracks?: TimelineTrack[]; audioTracks?: TimelineTrack[] } = {}) {
  const horizontalEl = document.createElement('div');
  Object.defineProperty(horizontalEl, 'scrollLeft', {
    value: 0,
    writable: true,
    configurable: true,
  });

  const videoEl = document.createElement('div');
  videoEl.className = 'video-tracks-scroll';
  videoEl.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000, height: 200 }) as DOMRect;

  const audioEl = document.createElement('div');
  audioEl.className = 'audio-tracks-scroll';
  audioEl.getBoundingClientRect = () =>
    ({ left: 0, top: 200, width: 1000, height: 200 }) as DOMRect;

  const scrollEl = document.createElement('div');
  scrollEl.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 1000, height: 400 }) as DOMRect;

  const horizontalScrollEl = ref(horizontalEl);
  const videoScrollEl = ref(videoEl);
  const audioScrollEl = ref(audioEl);
  const scrollElRef = ref(scrollEl);
  const videoTracksRef = ref(videoTracks);
  const audioTracksRef = ref(audioTracks);

  function getActiveScrollEl(e: PointerEvent | MouseEvent): HTMLElement | null {
    const target = e.target as HTMLElement;
    if (target?.closest('.audio-tracks-scroll')) return audioEl;
    if (target?.closest('.video-tracks-scroll')) return videoEl;
    return scrollEl;
  }

  let api!: ReturnType<typeof useTimelineClickActions>;

  const Comp = defineComponent({
    setup() {
      api = useTimelineClickActions({
        horizontalScrollEl,
        videoScrollEl,
        audioScrollEl,
        scrollEl: scrollElRef,
        videoTracks: videoTracksRef,
        audioTracks: audioTracksRef,
        getActiveScrollEl,
      });
      return () => h('div');
    },
  });

  activeWrapper = mount(Comp);
  return { api, horizontalEl, videoEl, audioEl, scrollEl };
}

function makeClickEvent(clientX: number, target?: HTMLElement): MouseEvent {
  return {
    button: 0,
    clientX,
    clientY: 50,
    target: target ?? null,
    currentTarget: target ?? null,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as MouseEvent;
}

describe('useTimelineClickActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    Object.assign(
      mockWorkspaceStore.userSettings,
      JSON.parse(JSON.stringify(DEFAULT_USER_SETTINGS)),
    );
    timelineStoreMock.currentTime = 0;
    timelineStoreMock.timelineZoom = 50;
    timelineStoreMock.isTrimModeActive = false;
  });

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
  });

  describe('handleTimelineClickAction', () => {
    it('does nothing for "none" action', () => {
      const { api } = setup();
      api.handleTimelineClickAction('none', makeClickEvent(100));
      expect(setCurrentTimeTicksMock).not.toHaveBeenCalled();
      expect(applyTimelineMock).not.toHaveBeenCalled();
    });

    it('resets zoom for "reset_zoom" action', () => {
      const { api } = setup();
      api.handleTimelineClickAction('reset_zoom', makeClickEvent(100));
      expect(resetTimelineZoomMock).toHaveBeenCalledOnce();
    });

    it('fits zoom for "fit_zoom" action', () => {
      const { api } = setup();
      api.handleTimelineClickAction('fit_zoom', makeClickEvent(100));
      expect(fitTimelineZoomMock).toHaveBeenCalledOnce();
    });

    it('centers playhead for "center_playhead" action', () => {
      const { api } = setup();
      api.handleTimelineClickAction('center_playhead', makeClickEvent(100));
      expect(requestCenterPlayheadMock).toHaveBeenCalledOnce();
    });

    it('does nothing for "select_item" action', () => {
      const { api } = setup();
      api.handleTimelineClickAction('select_item', makeClickEvent(100));
      expect(setCurrentTimeTicksMock).not.toHaveBeenCalled();
      expect(applyTimelineMock).not.toHaveBeenCalled();
    });

    it('does nothing for "select_area" action', () => {
      const { api } = setup();
      api.handleTimelineClickAction('select_area', makeClickEvent(100));
      expect(setCurrentTimeTicksMock).not.toHaveBeenCalled();
    });

    it('seeks for "seek" action', () => {
      const { api } = setup();
      api.handleTimelineClickAction('seek', makeClickEvent(200));
      expect(setCurrentTimeTicksMock).toHaveBeenCalledOnce();
      expect(setCurrentTimeTicksMock.mock.calls[0]![0]).toBeGreaterThan(0);
    });

    it('seeks for "move_playhead" action', () => {
      const { api } = setup();
      api.handleTimelineClickAction('move_playhead', makeClickEvent(300));
      expect(setCurrentTimeTicksMock).toHaveBeenCalledOnce();
      expect(setCurrentTimeTicksMock.mock.calls[0]![0]).toBeGreaterThan(0);
    });

    it('adds a marker for "add_marker" action', () => {
      const { api } = setup();
      api.handleTimelineClickAction('add_marker', makeClickEvent(250));
      expect(applyTimelineMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'add_marker', text: '' }),
      );
      const payload = applyTimelineMock.mock.calls[0]![0];
      expect(payload.id).toBeTruthy();
      expect(payload.timeTicks).toBeGreaterThan(0);
    });
  });

  describe('onTimelineClick', () => {
    it('ignores non-primary button clicks', () => {
      const { api, videoEl } = setup();
      const event = new MouseEvent('click', { button: 2 });
      Object.defineProperty(event, 'target', { value: videoEl, configurable: true });
      api.onTimelineClick(event);
      expect(setCurrentTimeTicksMock).not.toHaveBeenCalled();
    });

    it('ignores clicks on clips and buttons', () => {
      const { api } = setup();
      const clipEl = document.createElement('div');
      clipEl.setAttribute('data-clip-id', 'clip-1');
      const event = makeClickEvent(100, clipEl);
      api.onTimelineClick(event);
      expect(setCurrentTimeTicksMock).not.toHaveBeenCalled();
    });

    it('ignores clicks on gap elements', () => {
      const { api } = setup();
      const gapEl = document.createElement('div');
      gapEl.setAttribute('data-gap-id', 'gap-1');
      const event = makeClickEvent(100, gapEl);
      api.onTimelineClick(event);
      expect(setCurrentTimeTicksMock).not.toHaveBeenCalled();
    });

    it('disables trim mode when clicking outside clips in trim mode', () => {
      const { api, videoEl } = setup();
      timelineStoreMock.isTrimModeActive = true;
      const emptyEl = document.createElement('div');
      const event = makeClickEvent(100, emptyEl);
      api.onTimelineClick(event);
      expect(timelineStoreMock.isTrimModeActive).toBe(false);
    });

    it('keeps trim mode when clicking on a clip in trim mode', () => {
      const { api } = setup();
      timelineStoreMock.isTrimModeActive = true;
      const clipEl = document.createElement('div');
      clipEl.setAttribute('data-clip-id', 'clip-1');
      const event = makeClickEvent(100, clipEl);
      api.onTimelineClick(event);
      expect(timelineStoreMock.isTrimModeActive).toBe(true);
    });

    it('selects timeline properties when clicking below tracks', () => {
      const track: TimelineTrack = {
        id: 'v1',
        kind: 'video',
        clips: [],
      } as unknown as TimelineTrack;
      const { api, videoEl } = setup({ videoTracks: [track] });
      // Click at y=500 which is below the track height (40px)
      const event = {
        button: 0,
        clientX: 100,
        clientY: 500,
        target: videoEl,
        currentTarget: videoEl,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as MouseEvent;
      api.onTimelineClick(event);
      expect(selectTimelinePropertiesMock).toHaveBeenCalledOnce();
    });

    it('executes the configured click action for timeline clicks on empty area', () => {
      mockWorkspaceStore.userSettings.mouse.timeline.click = 'add_marker';
      const { api, videoEl } = setup();
      const emptyEl = document.createElement('div');
      const event = makeClickEvent(200, emptyEl);
      api.onTimelineClick(event);
      expect(applyTimelineMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'add_marker' }),
      );
    });
  });

  describe('executeTimelineRulerAction', () => {
    it('does nothing for "none" action', () => {
      const { api } = setup();
      api.executeTimelineRulerAction('none', makeClickEvent(100));
      expect(setCurrentTimeTicksMock).not.toHaveBeenCalled();
    });

    it('seeks for "seek" action', () => {
      const { api, horizontalEl } = setup();
      const rulerEl = document.createElement('div');
      rulerEl.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1000, height: 20 }) as DOMRect;
      const event = {
        clientX: 200,
        currentTarget: rulerEl,
      } as unknown as MouseEvent;
      api.executeTimelineRulerAction('seek', event);
      expect(setCurrentTimeTicksMock).toHaveBeenCalledOnce();
    });

    it('adds a marker for "add_marker" action', () => {
      const { api } = setup();
      const rulerEl = document.createElement('div');
      rulerEl.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1000, height: 20 }) as DOMRect;
      const event = {
        clientX: 300,
        currentTarget: rulerEl,
      } as unknown as MouseEvent;
      api.executeTimelineRulerAction('add_marker', event);
      expect(applyTimelineMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'add_marker', text: '' }),
      );
    });

    it('resets zoom for "reset_zoom" action', () => {
      const { api } = setup();
      const rulerEl = document.createElement('div');
      rulerEl.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: 1000, height: 20 }) as DOMRect;
      const event = {
        clientX: 100,
        currentTarget: rulerEl,
      } as unknown as MouseEvent;
      api.executeTimelineRulerAction('reset_zoom', event);
      expect(resetTimelineZoomMock).toHaveBeenCalledOnce();
    });
  });
});
