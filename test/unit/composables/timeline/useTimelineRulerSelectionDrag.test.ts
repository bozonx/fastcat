import { mount } from '@vue/test-utils';
import { defineComponent, h, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';

import { useTimelineRulerSelectionDrag } from '../../../../src/composables/timeline/useTimelineRulerSelectionDrag';

describe('useTimelineRulerSelectionDrag', () => {
  it('snaps created selection range to snap targets while dragging', async () => {
    const selectionRange = ref<{ startUs: number; endUs: number } | null>(null);
    const createSelectionRange = vi.fn();
    const updateSelectionRange = vi.fn();
    const setPreviewSelectionRange = vi.fn();

    let api!: ReturnType<typeof useTimelineRulerSelectionDrag>;

    const TestComponent = defineComponent({
      setup() {
        api = useTimelineRulerSelectionDrag({
          selectionRange,
          zoom: ref(50),
          fps: ref(25),
          getTimeUsFromPointerEvent: (event) => event.clientX * 1000,
          selectSelectionRange: vi.fn(),
          updateSelectionRange,
          createSelectionRange,
          setPreviewSelectionRange,
          computeSnapTargets: () => [1_000_000],
          snapThresholdPx: 1,
        });

        return () => h('div');
      },
    });

    const wrapper = mount(TestComponent);

    api.startSelectionRangeCreate({
      clientX: 0,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as PointerEvent);

    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1040 }));

    expect(api.displaySelectionRange.value).toEqual({
      startUs: 0,
      endUs: 1_000_000,
    });

    window.dispatchEvent(new PointerEvent('pointerup'));

    expect(createSelectionRange).toHaveBeenCalledWith({
      startUs: 0,
      endUs: 1_000_000,
    });

    wrapper.unmount();
  });
});
