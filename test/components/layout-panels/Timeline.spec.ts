import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import Timeline from '~/components/layout-panels/Timeline.vue';
import UiTimecode from '~/components/ui/editor/UiTimecode.vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { ref } from 'vue';

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
    
    // Set up real store state instead of mocking the whole store
    const timelineStore = useTimelineStore();
    timelineStore.currentTime = 10_000_000;
    timelineStore.timelineDoc = {
        tracks: [
            { id: 'v1', kind: 'video', locked: false, items: [], name: 'Video 1', opacity: 100, muted: false, hidden: false, blendMode: 'normal' },
            { id: 'a1', kind: 'audio', locked: true, items: [], name: 'Audio 1', opacity: 100, muted: false, hidden: false, blendMode: 'normal' }
        ]
    } as any;
    // Mock actions
    timelineStore.unlockAllTracks = vi.fn();
    timelineStore.setCurrentTimeUs = vi.fn();
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
    const timecode = component.findComponent(UiTimecode);
    
    expect(timecode.props('modelValue')).toBe(10_000_000);
  });

  it('shows reset buttons when state is active', async () => {
    const component = await mountSuspended(Timeline);
    
    // Since we mocked a locked track in timelineStore
    const lockButton = component.find('button.i-heroicons-lock-closed');
    expect(lockButton.exists()).toBe(true);
  });

  it('calls unlockAllTracks when reset lock button is clicked', async () => {
    const timelineStore = useTimelineStore();
    const component = await mountSuspended(Timeline);
    
    const lockButton = component.find('button.i-heroicons-lock-closed');
    await lockButton.trigger('click');
    
    expect(timelineStore.unlockAllTracks).toHaveBeenCalled();
  });

  it('updates current time via timecode', async () => {
    const timelineStore = useTimelineStore();
    const component = await mountSuspended(Timeline);
    const timecode = component.findComponent(UiTimecode);
    
    await timecode.vm.$emit('update:modelValue', 20_000_000);
    expect(timelineStore.setCurrentTimeUs).toHaveBeenCalledWith(20_000_000);
  });
});
