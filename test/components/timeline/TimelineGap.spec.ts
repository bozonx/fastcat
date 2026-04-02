import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
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
  const originalPointerEvent = globalThis.PointerEvent;

  beforeEach(() => {
    mockTimelineStore.selectedItemIds = [];
    mockSelectionStore.selectedEntity = null;
  });

  afterEach(() => {
    if (originalPointerEvent) {
      globalThis.PointerEvent = originalPointerEvent;
    } else {
      // @ts-expect-error test cleanup for environments without PointerEvent
      delete globalThis.PointerEvent;
    }
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

    // We need to simulate a pointerdown with button 0 (left click)
    // resolveTimelineDragAction uses e.button
    await component.find('div.absolute').trigger('pointerdown', { button: 0 });
    // In our mock settings, button 0 is 'move_clips' which triggers marqueeStart?
    // Wait, let's check resolveTimelineDragAction. button 0 -> drag -> 'move_clips'
    // shouldStartMarquee('move_clips') -> true -> emit('marqueeStart')
    expect(component.emitted('marqueeStart')).toBeTruthy();
  });

  it('emits select for mobile touch tap on pointerup without starting marquee', async () => {
    class MockPointerEvent extends Event {
      button: number;
      clientX: number;
      clientY: number;
      pointerType: string;

      constructor(type: string, init: Record<string, unknown> = {}) {
        super(type, { bubbles: true, cancelable: true });
        this.button = (init.button as number) ?? 0;
        this.clientX = (init.clientX as number) ?? 0;
        this.clientY = (init.clientY as number) ?? 0;
        this.pointerType = (init.pointerType as string) ?? 'touch';
      }
    }

    Object.defineProperty(globalThis, 'PointerEvent', {
      value: MockPointerEvent,
      configurable: true,
      writable: true,
    });

    const component = await mountSuspended(TimelineGap, {
      props: { item, trackId: 'v1', isMobile: true },
    });

    const gap = component.find('div.absolute');
    const event = new MockPointerEvent('pointerdown', {
      button: 0,
      clientX: 24,
      clientY: 12,
      pointerType: 'touch',
    });

    gap.element.dispatchEvent(event);
    window.dispatchEvent(new MockPointerEvent('pointerup', { button: 0, pointerType: 'touch' }));
    await component.vm.$nextTick();

    expect(component.emitted('select')).toBeTruthy();
    expect(component.emitted('marqueeStart')).toBeFalsy();
  });

  it('does not emit select for mobile swipe on gap', async () => {
    class MockPointerEvent extends Event {
      button: number;
      clientX: number;
      clientY: number;
      pointerType: string;

      constructor(type: string, init: Record<string, unknown> = {}) {
        super(type, { bubbles: true, cancelable: true });
        this.button = (init.button as number) ?? 0;
        this.clientX = (init.clientX as number) ?? 0;
        this.clientY = (init.clientY as number) ?? 0;
        this.pointerType = (init.pointerType as string) ?? 'touch';
      }
    }

    Object.defineProperty(globalThis, 'PointerEvent', {
      value: MockPointerEvent,
      configurable: true,
      writable: true,
    });

    const component = await mountSuspended(TimelineGap, {
      props: { item, trackId: 'v1', isMobile: true },
    });

    const gap = component.find('div.absolute');
    const downEvent = new MockPointerEvent('pointerdown', {
      button: 0,
      clientX: 24,
      clientY: 12,
      pointerType: 'touch',
    });

    gap.element.dispatchEvent(downEvent);
    window.dispatchEvent(
      new MockPointerEvent('pointermove', {
        button: 0,
        clientX: 40,
        clientY: 12,
        pointerType: 'touch',
      }),
    );
    window.dispatchEvent(
      new MockPointerEvent('pointerup', {
        button: 0,
        clientX: 40,
        clientY: 12,
        pointerType: 'touch',
      }),
    );
    await component.vm.$nextTick();

    expect(component.emitted('select')).toBeFalsy();
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
});
