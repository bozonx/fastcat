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
});
