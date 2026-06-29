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
  const setCurrentTimeUs = vi.fn();
  // Returns a recognizable snapped value so we can prove snapping was applied.
  const resolvePlayheadClickTimeUs = vi.fn((raw: number) => raw + 777);

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
          fitTimelineZoom: vi.fn(),
          setCurrentTimeUs,
        },
        selectionStore: { clearSelection: vi.fn(), selectTimelineMarker },
        workspaceStore: { userSettings },
        isDraggingSelectionRange: ref(false),
        suppressNextRulerClick: ref(false),
        startSelectionRangeCreate: vi.fn(),
        resolvePlayheadClickTimeUs,
        emit: Object.assign(vi.fn(), {}) as never,
      });
      return () => h('div');
    },
  });

  activeWrapper = mount(Comp);
  return { api, applyTimeline, selectTimelineMarker, setCurrentTimeUs, resolvePlayheadClickTimeUs };
}

describe('useTimelineRulerInteractions', () => {
  it('creates a marker through the snapping resolver (add_marker)', () => {
    const { api, applyTimeline, selectTimelineMarker, resolvePlayheadClickTimeUs } =
      setupInteractions({ click: 'add_marker' });

    api.onRulerClick(new MouseEvent('click', { button: 0 }));

    expect(resolvePlayheadClickTimeUs).toHaveBeenCalled();
    expect(applyTimeline).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'add_marker', timeUs: 777, text: '' }),
    );
    // The freshly created marker becomes the selection.
    const createdId = applyTimeline.mock.calls[0]![0].id;
    expect(selectTimelineMarker).toHaveBeenCalledWith(createdId);
  });

  it('seeks through the snapping resolver (seek)', () => {
    const { api, setCurrentTimeUs, resolvePlayheadClickTimeUs } = setupInteractions({
      click: 'seek',
    });

    api.onRulerClick(new MouseEvent('click', { button: 0 }));

    expect(resolvePlayheadClickTimeUs).toHaveBeenCalled();
    expect(setCurrentTimeUs).toHaveBeenCalledWith(777);
  });

  it('ignores non-primary clicks', () => {
    const { api, applyTimeline } = setupInteractions({ click: 'add_marker' });
    api.onRulerClick(new MouseEvent('click', { button: 2 }));
    expect(applyTimeline).not.toHaveBeenCalled();
  });
});
