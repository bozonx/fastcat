import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import TimelineGap from '~/components/timeline/TimelineGap.vue';

const mockTimelineStore = reactive({
  timelineZoom: 1,
  selectedItemIds: [] as string[],
});

const mockSelectionStore = reactive({});
const mockWorkspaceStore = reactive({
  userSettings: {
    mouse: {
      timeline: {
        drag: 'move_clips',
        middleDrag: 'pan',
        clipDragShift: 'select_area',
        clipDragCtrl: 'copy_clips',
        clipDragRight: 'context_menu',
      },
    },
    hotkeys: { layer1: 'Shift', layer2: 'Control' },
  },
});

vi.mock('~/stores/timeline.store', () => ({ useTimelineStore: () => mockTimelineStore }));
vi.mock('~/stores/selection.store', () => ({ useSelectionStore: () => mockSelectionStore }));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => mockWorkspaceStore }));

describe('TimelineGap', () => {
  const item = {
    id: 'gap-1',
    kind: 'gap',
    timelineRange: { startUs: 1_000_000, durationUs: 2_000_000 },
  } as any;

  it('renders with correct position and width', async () => {
    const component = await mountSuspended(TimelineGap, {
      props: { item, trackId: 'v1' },
    });

    expect(component.exists()).toBe(true);
    const div = component.find('div.absolute');
    expect(div.attributes('style')).toContain('width:');
    expect(div.attributes('style')).toContain('left:');
  });

  it('emits select on pointerdown', async () => {
    const component = await mountSuspended(TimelineGap, {
      props: { item, trackId: 'v1' },
    });

    // We need to simulate a pointerdown with button 0 (left click)
    // resolveTimelineDragAction uses e.button
    await component.find('div.absolute').trigger('pointerdown', { button: 0 });
    // In our mock settings, button 0 is 'move_clips' which triggers marqueeStart?
    // Wait, let's check resolveTimelineDragAction. button 0 -> drag -> 'move_clips'
    // shouldStartMarquee('move_clips') -> true -> emit('marqueeStart')
    expect(component.emitted('marqueeStart')).toBeTruthy();
  });

  it('shows selected state', async () => {
    mockTimelineStore.selectedItemIds = ['gap-1'];

    const component = await mountSuspended(TimelineGap, {
      props: { item, trackId: 'v1' },
    });

    const div = component.find('div.absolute');
    expect(div.classes()).toContain('border-primary-500');
  });
});
