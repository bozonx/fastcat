/** @vitest-environment happy-dom */
import { defineComponent, h, ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelinePlayheadDrag } from '~/composables/timeline/useTimelinePlayheadDrag';

const setCurrentTimeUsMock = vi.fn((us: number) => {
  timelineStoreMock.currentTime = us;
});

const timelineStoreMock = {
  currentTime: 0,
  timelineZoom: 50,
  setCurrentTimeTicks: setCurrentTimeUsMock,
};

const workspaceStoreMock = {
  userSettings: { hotkeys: { bindings: {} } },
};

// Escape ("general.deselect") is the only command the drag cares about; match it
// purely on the key so the test does not depend on the real hotkey resolver.
const isCommandMatchedMock = vi.fn(
  (args: { event: KeyboardEvent; cmdId: string }) =>
    args.cmdId === 'general.deselect' && args.event.key === 'Escape',
);

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => timelineStoreMock,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}));

vi.mock('~/composables/editor/hotkeys/useEffectiveHotkeys', () => ({
  useEffectiveHotkeys: () => ({
    hotkeyLookup: ref({}),
    defaultHotkeyLookup: ref({}),
  }),
}));

vi.mock('~/utils/hotkeys/runtime', () => ({
  isCommandMatched: (args: { event: KeyboardEvent; cmdId: string }) => isCommandMatchedMock(args),
}));

let activeWrapper: VueWrapper | null = null;

function setup() {
  const scrollEl = ref<HTMLElement | null>(null);
  let api!: ReturnType<typeof useTimelinePlayheadDrag>;

  const Comp = defineComponent({
    setup() {
      api = useTimelinePlayheadDrag(scrollEl);
      return () => h('div');
    },
  });

  activeWrapper = mount(Comp);
  return { api: api!, scrollEl };
}

function makeRulerEl() {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 20 }) as DOMRect;
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  return el;
}

function pointerDownEvent(el: HTMLElement, clientX: number, button = 0): PointerEvent {
  return {
    button,
    clientX,
    clientY: 0,
    pointerId: 7,
    pointerType: 'mouse',
    currentTarget: el,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
}

function movePointerEvent(clientX: number, clientY = 0, buttons = 1): PointerEvent {
  return {
    clientX,
    clientY,
    buttons,
    pointerId: 7,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
}

describe('useTimelinePlayheadDrag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    timelineStoreMock.currentTime = 0;
    timelineStoreMock.timelineZoom = 50;
  });

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
  });

  it('ignores non-primary buttons on the ruler', () => {
    const { api } = setup();
    const el = makeRulerEl();

    api.onTimeRulerPointerDown(pointerDownEvent(el, 200, 2));

    expect(api.isDraggingPlayhead.value).toBe(false);
    expect(setCurrentTimeUsMock).not.toHaveBeenCalled();
    expect(el.setPointerCapture).not.toHaveBeenCalled();
  });

  it('seeks and starts a playhead drag on primary pointer down', () => {
    const { api } = setup();
    const el = makeRulerEl();

    api.onTimeRulerPointerDown(pointerDownEvent(el, 200));

    expect(api.isDraggingPlayhead.value).toBe(true);
    expect(api.hasPlayheadMoved.value).toBe(false);
    expect(setCurrentTimeUsMock).toHaveBeenCalledTimes(1);
    expect(setCurrentTimeUsMock.mock.calls[0]![0]).toBeGreaterThan(0);
    expect(el.setPointerCapture).toHaveBeenCalledWith(7);
  });

  it('keeps hasPlayheadMoved false inside the deadzone but flips it once exceeded', () => {
    const { api } = setup();
    const el = makeRulerEl();
    api.onTimeRulerPointerDown(pointerDownEvent(el, 200));

    // Within DRAG_DEADZONE_PX (3px) of the start → still counts as a click.
    expect(api.onGlobalPointerMove(movePointerEvent(202, 1))).toBe(true);
    expect(api.hasPlayheadMoved.value).toBe(false);

    // Beyond the deadzone → a real drag.
    api.onGlobalPointerMove(movePointerEvent(260, 0));
    expect(api.hasPlayheadMoved.value).toBe(true);
  });

  it('updates the playhead time as the pointer moves during a drag', () => {
    const { api } = setup();
    const el = makeRulerEl();
    api.onTimeRulerPointerDown(pointerDownEvent(el, 100));
    setCurrentTimeUsMock.mockClear();

    api.onGlobalPointerMove(movePointerEvent(400));
    const forward = setCurrentTimeUsMock.mock.calls.at(-1)![0];

    api.onGlobalPointerMove(movePointerEvent(200));
    const back = setCurrentTimeUsMock.mock.calls.at(-1)![0];

    expect(forward).toBeGreaterThan(back);
  });

  it('returns false from move handlers when no drag is active', () => {
    const { api } = setup();
    expect(api.onGlobalPointerMove(movePointerEvent(400))).toBe(false);
    expect(setCurrentTimeUsMock).not.toHaveBeenCalled();
  });

  it('ends the drag (via pointerup) when buttons are released mid-move', () => {
    const { api } = setup();
    const el = makeRulerEl();
    api.onTimeRulerPointerDown(pointerDownEvent(el, 100));

    api.onGlobalPointerMove(movePointerEvent(400, 0, /* buttons */ 0));

    expect(api.isDraggingPlayhead.value).toBe(false);
  });

  it('releases the captured element (not the event target) on pointer up', () => {
    const { api } = setup();
    const el = makeRulerEl();
    api.onTimeRulerPointerDown(pointerDownEvent(el, 100));

    // pointerup is delivered by the parent bound to window, so currentTarget is
    // NOT the captured ruler element — releasing must still target `el`.
    api.onGlobalPointerUp({ pointerId: 7, currentTarget: null } as unknown as PointerEvent);

    expect(api.isDraggingPlayhead.value).toBe(false);
    expect(el.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('restores the pre-drag time and releases capture when Escape is pressed', () => {
    const { api } = setup();
    const el = makeRulerEl();

    timelineStoreMock.currentTime = 1_234_567;
    api.onTimeRulerPointerDown(pointerDownEvent(el, 500));
    // Drag elsewhere so the live time diverges from the pre-drag anchor.
    api.onGlobalPointerMove(movePointerEvent(50));
    setCurrentTimeUsMock.mockClear();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(api.isDraggingPlayhead.value).toBe(false);
    expect(setCurrentTimeUsMock).toHaveBeenCalledWith(1_234_567);
    expect(el.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('is inert after unmount (no lingering keydown listener)', () => {
    const { api } = setup();
    const el = makeRulerEl();
    api.onTimeRulerPointerDown(pointerDownEvent(el, 100));

    activeWrapper?.unmount();
    activeWrapper = null;
    setCurrentTimeUsMock.mockClear();

    // The keydown listener must have been torn down on unmount.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(setCurrentTimeUsMock).not.toHaveBeenCalled();
  });
});
