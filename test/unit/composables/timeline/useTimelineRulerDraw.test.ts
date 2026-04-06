/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useTimelineRulerDraw } from '~/composables/timeline/useTimelineRulerDraw';

vi.mock('@vueuse/core', () => ({
  useResizeObserver: vi.fn(),
}));

describe('useTimelineRulerDraw', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not reassign canvas size when width, height and dpr stay the same', () => {
    let scheduleDraw: (() => void) | null = null;
    let widthAssignments = 0;
    let heightAssignments = 0;

    const ctx = {
      setTransform: vi.fn(),
      scale: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      fillText: vi.fn(),
      stroke: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textAlign: 'center',
      textBaseline: 'top',
    };

    const canvas = {
      _width: 0,
      _height: 0,
      get width() {
        return this._width;
      },
      set width(value: number) {
        widthAssignments += 1;
        this._width = value;
      },
      get height() {
        return this._height;
      },
      set height(value: number) {
        heightAssignments += 1;
        this._height = value;
      },
      getContext: vi.fn(() => ctx),
    } as unknown as HTMLCanvasElement;

    const TestComponent = defineComponent({
      setup() {
        const api = useTimelineRulerDraw({
          containerRef: ref(null),
          canvasRef: ref(canvas),
          scrollEl: ref(null),
          width: ref(300),
          height: ref(40),
          scrollLeft: ref(0),
          zoom: ref(50),
          fps: ref(30),
          textColor: '#fff',
          tickColor: '#999',
          majorTickWidth: 1,
          subTickWidth: 1,
          interfaceScale: ref(14),
          isMobile: ref(false),
        });

        scheduleDraw = api.scheduleDraw;
        return () => h('div');
      },
    });

    const wrapper = mount(TestComponent);

    scheduleDraw?.();
    expect(widthAssignments).toBe(1);
    expect(heightAssignments).toBe(1);

    scheduleDraw?.();
    expect(widthAssignments).toBe(1);
    expect(heightAssignments).toBe(1);

    wrapper.unmount();
  });
});
