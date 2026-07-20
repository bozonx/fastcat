/** @vitest-environment happy-dom */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { DEFAULT_USER_SETTINGS } from '~/utils/settings/defaults';

import { useTimelineRulerInteractions } from '~/composables/timeline/useTimelineRulerInteractions';

let activeWrapper: VueWrapper | null = null;

afterEach(() => {
  activeWrapper?.unmount();
  activeWrapper = null;
});

function setupInteractions(rulerOverrides: Record<string, unknown>) {
  const applyTimeline = vi.fn();
  const selectTimelineMarker = vi.fn();
  const setCurrentTimeTicks = vi.fn();
  const requestCenterPlayhead = vi.fn();
  const fitTimelineZoom = vi.fn();
  // Returns a recognizable snapped value so we can prove snapping was applied.
  const resolvePlayheadClickTimeTicks = vi.fn((raw: number) => raw + 777);

  const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
  Object.assign(userSettings.mouse.ruler, rulerOverrides);

  let api!: ReturnType<typeof useTimelineRulerInteractions>;

  const Comp = defineComponent({
    setup() {
      api = useTimelineRulerInteractions({
        containerRef: ref(null),
        scrollLeft: ref(0),
        zoom: ref(50),
        timelineStore: {
          applyTimeline,
          clearSelection: vi.fn(),
          removeSelectionRange: vi.fn(),
          resetTimelineZoom: vi.fn(),
          fitTimelineZoom,
          setCurrentTimeTicks,
          requestCenterPlayhead,
        },
        selectionStore: { clearSelection: vi.fn(), selectTimelineMarker },
        workspaceStore: { userSettings },
        isDraggingSelectionRange: ref(false),
        suppressNextRulerClick: ref(false),
        startSelectionRangeCreate: vi.fn(),
        resolvePlayheadClickTimeTicks,
        emit: Object.assign(vi.fn(), {}) as never,
      });
      return () => h('div');
    },
  });

  activeWrapper = mount(Comp);
  return {
    api,
    applyTimeline,
    selectTimelineMarker,
    setCurrentTimeTicks,
    requestCenterPlayhead,
    fitTimelineZoom,
    resolvePlayheadClickTimeTicks,
  };
}

describe('useTimelineRulerInteractions', () => {
  it('creates a marker through the snapping resolver (add_marker)', () => {
    const { api, applyTimeline, selectTimelineMarker, resolvePlayheadClickTimeTicks } =
      setupInteractions({ click: 'add_marker' });

    api.onRulerClick(new MouseEvent('click', { button: 0 }));

    expect(resolvePlayheadClickTimeTicks).toHaveBeenCalled();
    expect(applyTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'add_marker', timeTicks: 777, text: '' }),
    );
    // The freshly created marker becomes the selection.
    const createdId = applyTimeline.mock.calls[0]![0].id;
    expect(selectTimelineMarker).toHaveBeenCalledWith(createdId);
  });

  it('seeks through the snapping resolver (seek)', () => {
    const { api, setCurrentTimeTicks, resolvePlayheadClickTimeTicks } = setupInteractions({
      click: 'seek',
    });

    api.onRulerClick(new MouseEvent('click', { button: 0 }));

    expect(resolvePlayheadClickTimeTicks).toHaveBeenCalled();
    expect(setCurrentTimeTicks).toHaveBeenCalledWith(777);
  });

  it('ignores non-primary clicks', () => {
    const { api, applyTimeline } = setupInteractions({ click: 'add_marker' });
    api.onRulerClick(new MouseEvent('click', { button: 2 }));
    expect(applyTimeline).not.toHaveBeenCalled();
  });

  it('centers the playhead (center_playhead)', () => {
    const { api, requestCenterPlayhead } = setupInteractions({ click: 'center_playhead' });

    api.onRulerClick(new MouseEvent('click', { button: 0 }));

    expect(requestCenterPlayhead).toHaveBeenCalledOnce();
  });

  it('centers the playhead on ruler middle click without fitting zoom', () => {
    const { api, requestCenterPlayhead, fitTimelineZoom } = setupInteractions({
      middleClick: 'center_playhead',
    });
    const event = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
    const stopPropagation = vi.spyOn(event, 'stopPropagation');

    api.onRulerAuxClick(event);

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(requestCenterPlayhead).toHaveBeenCalledOnce();
    expect(fitTimelineZoom).not.toHaveBeenCalled();
  });

  it('resets zoom for "reset_zoom" click action', () => {
    const resetTimelineZoom = vi.fn();
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { click: 'reset_zoom' });

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(null),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom,
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks: vi.fn(),
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: vi.fn() as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    api2.onRulerClick(new MouseEvent('click', { button: 0 }));

    expect(resetTimelineZoom).toHaveBeenCalledOnce();
  });

  it('fits zoom for "fit_zoom" click action', () => {
    const { api, fitTimelineZoom } = setupInteractions({ click: 'fit_zoom' });

    api.onRulerClick(new MouseEvent('click', { button: 0 }));

    expect(fitTimelineZoom).toHaveBeenCalledOnce();
  });

  it('clears selection for "clear_selection" click action', () => {
    const removeSelectionRange = vi.fn();
    const clearSelectionTimeline = vi.fn();
    const clearSelectionStore = vi.fn();
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { click: 'clear_selection' });

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(null),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: clearSelectionTimeline,
            removeSelectionRange,
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks: vi.fn(),
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: clearSelectionStore, selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: vi.fn() as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    api2.onRulerClick(new MouseEvent('click', { button: 0 }));

    expect(removeSelectionRange).toHaveBeenCalledOnce();
    expect(clearSelectionTimeline).toHaveBeenCalledOnce();
    expect(clearSelectionStore).toHaveBeenCalledOnce();
  });

  it('starts selection range for "select_area" click action', () => {
    const startSelectionRangeCreate = vi.fn();
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { click: 'select_area' });

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(null),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks: vi.fn(),
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate,
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: vi.fn() as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    api2.onRulerClick(new MouseEvent('click', { button: 0 }));

    expect(startSelectionRangeCreate).toHaveBeenCalledOnce();
  });

  it('ignores clicks when suppressNextRulerClick is true', () => {
    const { api, applyTimeline } = setupInteractions({ click: 'add_marker' });

    // We need to set suppressNextRulerClick to true
    // Since setupInteractions doesn't expose it, we re-setup
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { click: 'add_marker' });

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const suppressRef = ref(true);
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(null),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks: vi.fn(),
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: suppressRef,
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: vi.fn() as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    api2.onRulerClick(new MouseEvent('click', { button: 0 }));

    // Should be suppressed
    expect(suppressRef.value).toBe(false);
  });

  it('uses shiftClick action when layer1 modifier is active', () => {
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    userSettings.hotkeys.layer1 = 'Shift';
    Object.assign(userSettings.mouse.ruler, { shiftClick: 'seek', click: 'add_marker' });

    const setCurrentTimeTicks = vi.fn();
    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(null),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks,
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: vi.fn() as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    const event = new MouseEvent('click', { button: 0, shiftKey: true });
    api2.onRulerClick(event);

    expect(setCurrentTimeTicks).toHaveBeenCalled();
  });

  it('emits dblclick-ruler event on double click', () => {
    const emit = vi.fn();
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { doubleClick: 'none' });

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(null),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks: vi.fn(),
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: emit as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    api2.onRulerDblClick(new MouseEvent('dblclick', { button: 0 }));

    expect(emit).toHaveBeenCalledWith('dblclick-ruler', expect.any(Number));
  });

  it('ignores non-primary button on double click', () => {
    const emit = vi.fn();
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { doubleClick: 'add_marker' });

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(null),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks: vi.fn(),
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: emit as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    api2.onRulerDblClick(new MouseEvent('dblclick', { button: 2 }));

    expect(emit).not.toHaveBeenCalled();
  });

  it('emits start-pan for "pan" drag action', () => {
    const emit = vi.fn();
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { drag: 'pan' });

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(null),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks: vi.fn(),
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: emit as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    api2.onRulerPointerDown({
      button: 0,
      clientX: 100,
      clientY: 20,
      pointerId: 1,
      preventDefault: vi.fn(),
      currentTarget: null,
    } as unknown as PointerEvent);

    expect(emit).toHaveBeenCalledWith('start-pan', expect.any(Object));
  });

  it('emits start-playhead-drag for "move_playhead" drag action', () => {
    const emit = vi.fn();
    const setCurrentTimeTicks = vi.fn();
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { drag: 'move_playhead' });

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(null),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks,
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: emit as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    api2.onRulerPointerDown({
      button: 0,
      clientX: 100,
      clientY: 20,
      pointerId: 1,
      preventDefault: vi.fn(),
      currentTarget: null,
    } as unknown as PointerEvent);

    expect(setCurrentTimeTicks).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith('start-playhead-drag', expect.any(Object));
  });

  it('emits pointerdown for "none" drag action', () => {
    const emit = vi.fn();
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { drag: 'none' });

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(null),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks: vi.fn(),
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: emit as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    api2.onRulerPointerDown({
      button: 0,
      clientX: 100,
      clientY: 20,
      pointerId: 1,
      preventDefault: vi.fn(),
      currentTarget: null,
    } as unknown as PointerEvent);

    expect(emit).toHaveBeenCalledWith('pointerdown', expect.any(Object));
  });

  it('starts middle drag pan for middleDrag="pan"', () => {
    const emit = vi.fn();
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { middleDrag: 'pan' });

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(null),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks: vi.fn(),
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: emit as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    api2.onRulerPointerDown({
      button: 1,
      clientX: 100,
      clientY: 20,
      pointerId: 5,
      preventDefault: vi.fn(),
      currentTarget: null,
    } as unknown as PointerEvent);

    expect(emit).toHaveBeenCalledWith('start-pan', expect.any(Object));
  });

  it('ignores pointer down when dragging selection range', () => {
    const emit = vi.fn();
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { drag: 'pan' });

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(null),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks: vi.fn(),
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(true),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: emit as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    api2.onRulerPointerDown({
      button: 0,
      clientX: 100,
      clientY: 20,
      pointerId: 1,
      preventDefault: vi.fn(),
      currentTarget: null,
    } as unknown as PointerEvent);

    expect(emit).not.toHaveBeenCalled();
  });

  it('prevents default and emits wheel event on ruler wheel', () => {
    const emit = vi.fn();
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { wheel: 'zoom_horizontal' });

    const containerEl = document.createElement('div');

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(containerEl),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks: vi.fn(),
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: emit as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    const wheelEvent = new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true });
    containerEl.dispatchEvent(wheelEvent);

    expect(emit).toHaveBeenCalledWith('wheel', expect.any(WheelEvent));
  });

  it('does not emit wheel for "none" action', () => {
    const emit = vi.fn();
    const userSettings = structuredClone(DEFAULT_USER_SETTINGS);
    Object.assign(userSettings.mouse.ruler, { wheel: 'none' });

    const containerEl = document.createElement('div');

    let api2!: ReturnType<typeof useTimelineRulerInteractions>;
    const Comp = defineComponent({
      setup() {
        api2 = useTimelineRulerInteractions({
          containerRef: ref(containerEl),
          scrollLeft: ref(0),
          zoom: ref(50),
          timelineStore: {
            applyTimeline: vi.fn(),
            clearSelection: vi.fn(),
            removeSelectionRange: vi.fn(),
            resetTimelineZoom: vi.fn(),
            fitTimelineZoom: vi.fn(),
            setCurrentTimeTicks: vi.fn(),
            requestCenterPlayhead: vi.fn(),
          },
          selectionStore: { clearSelection: vi.fn(), selectTimelineMarker: vi.fn() },
          workspaceStore: { userSettings },
          isDraggingSelectionRange: ref(false),
          suppressNextRulerClick: ref(false),
          startSelectionRangeCreate: vi.fn(),
          resolvePlayheadClickTimeTicks: vi.fn((raw: number) => raw),
          emit: emit as never,
        });
        return () => h('div');
      },
    });
    activeWrapper = mount(Comp);

    const wheelEvent = new WheelEvent('wheel', { deltaY: 10, bubbles: true, cancelable: true });
    containerEl.dispatchEvent(wheelEvent);

    expect(emit).not.toHaveBeenCalledWith('wheel', expect.anything());
  });
});
