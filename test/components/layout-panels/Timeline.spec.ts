import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import Timeline from '~/components/layout-panels/Timeline.vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { ref } from 'vue';

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: vi.fn(() => ({
    currentTime: 10_000_000,
    duration: 60_000_000,
    timelineZoom: 100,
    timelineDoc: {
        tracks: [
            { id: 'v1', kind: 'video', locked: false, items: [] },
            { id: 'a1', kind: 'audio', locked: true, items: [] }
        ]
    },
    trackHeights: {},
    selectedItemIds: [],
    hoveredTrackId: null,
    isAnyTrackSoloed: ref(false),
    isTrimModeActive: ref(false),
    unlockAllTracks: vi.fn(),
    unsoloAllTracks: vi.fn(),
    setCurrentTimeUs: vi.fn(),
    fitTimelineZoom: vi.fn(),
    selectTimelineProperties: vi.fn(),
    selectTrack: vi.fn(),
    clearSelection: vi.fn(),
    goToPreviousMarker: vi.fn(),
    goToNextMarker: vi.fn(),
    addMarkerAtPlayhead: vi.fn(),
    addTextClipAtPlayhead: vi.fn(),
    addAdjustmentClipAtPlayhead: vi.fn(),
    addBackgroundClipAtPlayhead: vi.fn(),
  })),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => ({
    currentProjectId: ref('test-project'),
    currentView: ref('cut'),
    projectSettings: {
        project: {
            fps: 30
        }
    }
  })),
}));

// Mock composables to avoid side effects
vi.mock('~/composables/timeline/useTimelineSectionResize', () => ({
    useTimelineSectionResize: () => ({
        videoSectionPercent: ref(50),
        sectionContainerRef: ref(null),
        onSectionResizeStart: vi.fn(),
        resetSectionPercent: vi.fn(),
    })
}));

describe('Timeline Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly with all sections', async () => {
    const component = await mountSuspended(Timeline);
    
    // Check main components
    expect(component.findComponent({ name: 'TimelineToolbar' }).exists()).toBe(true);
    expect(component.findComponent({ name: 'TimelineRuler' }).exists()).toBe(true);
    expect(component.findAllComponents({ name: 'TimelineTrackSection' }).length).toBe(2);
  });

  it('displays correct timecode from store', async () => {
    const component = await mountSuspended(Timeline);
    const timecode = component.findComponent({ name: 'UiTimecode' });
    
    expect(timecode.props('modelValue')).toBe(10_000_000);
  });

  it('shows reset buttons when state is active', async () => {
    const component = await mountSuspended(Timeline);
    
    // Since we mocked a locked track in timelineStore
    const lockButton = component.find('button .i-heroicons-lock-closed');
    expect(lockButton.exists()).toBe(true);
  });

  it('calls unlockAllTracks when reset lock button is clicked', async () => {
    const timelineStore = useTimelineStore();
    const component = await mountSuspended(Timeline);
    
    const lockButton = component.find('button .i-heroicons-lock-closed').element.parentElement;
    await (lockButton as HTMLElement).click();
    
    expect(timelineStore.unlockAllTracks).toHaveBeenCalled();
  });

  it('updates current time via timecode', async () => {
    const timelineStore = useTimelineStore();
    const component = await mountSuspended(Timeline);
    const timecode = component.findComponent({ name: 'UiTimecode' });
    
    await timecode.vm.$emit('update:modelValue', 20_000_000);
    expect(timelineStore.setCurrentTimeUs).toHaveBeenCalledWith(20_000_000);
  });
});
