import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { nextTick, reactive } from 'vue';
import TimelineGap from '~/components/timeline/TimelineGap.vue';

const mockTimelineStore = reactive({
  timelineZoom: 1,
  selectedItemIds: [] as string[],
});

const mockSelectionStore = reactive({
  selectedEntity: null as null | {
    source: 'timeline';
    kind: 'gap';
    trackId: string;
    itemId: string;
  },
});
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
vi.mock('~/composables/timeline/useTrackContextMenu', () => ({
  useTrackContextMenu: () => ({
    getTrackContextMenuItems: () => [],
  }),
}));

describe('TimelineGap', () => {
  beforeEach(() => {
    mockTimelineStore.selectedItemIds = [];
    mockSelectionStore.selectedEntity = null;
  });

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

    await component.find('div.absolute').trigger('pointerdown', { button: 0 });
    expect(component.emitted('marqueeStart')).toBeTruthy();
  });

  it('emits select immediately for mobile touch tap without starting marquee', async () => {
    const component = await mountSuspended(TimelineGap, {
      props: { item, trackId: 'v1', isMobile: true },
    });

    const gapElement = component.find('div.absolute');
    await gapElement.trigger('pointerdown', {
      button: 0,
      clientX: 24,
      clientY: 12,
      pointerType: 'touch',
    });
    await gapElement.trigger('click', {
      clientX: 24,
      clientY: 12,
    });

    expect(component.emitted('select')).toBeTruthy();
    expect(component.emitted('marqueeStart')).toBeFalsy();
  });

  it('shows selected state', async () => {
    mockTimelineStore.selectedItemIds = ['gap-1'];

    const component = await mountSuspended(TimelineGap, {
      props: { item, trackId: 'v1' },
    });

    const div = component.find('div.absolute');
    expect(div.classes()).toContain('border-primary-500');
  });

  it('shows selected state from selection store for gap drawer sync', async () => {
    mockSelectionStore.selectedEntity = {
      source: 'timeline',
      kind: 'gap',
      trackId: 'v1',
      itemId: 'gap-1',
    };

    const component = await mountSuspended(TimelineGap, {
      props: { item, trackId: 'v1' },
    });

    const div = component.find('div.absolute');
    expect(div.classes()).toContain('border-primary-500');
  });

  it('dispatches a synthetic contextmenu on right click so the gap menu can open', async () => {
    const component = await mountSuspended(TimelineGap, {
      props: { item, trackId: 'v1' },
      attachTo: document.body,
    });

    const gapElement = component.find('div.absolute');
    const contextMenuHandler = vi.fn();
    gapElement.element.addEventListener('contextmenu', contextMenuHandler);

    const pointerDownEvent = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 32,
      clientY: 16,
    });
    gapElement.element.dispatchEvent(pointerDownEvent);
    window.dispatchEvent(new Event('pointerup'));
    await nextTick();
    await Promise.resolve();

    expect(pointerDownEvent.defaultPrevented).toBe(true);
    expect(contextMenuHandler).toHaveBeenCalledTimes(1);
    expect(contextMenuHandler.mock.calls[0]?.[0]).toMatchObject({
      clientX: 32,
      clientY: 16,
    });

    gapElement.element.removeEventListener('contextmenu', contextMenuHandler);
    component.unmount();
  });
});
