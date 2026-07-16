/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { useTimelineRulerDraw } from '~/composables/timeline/useTimelineRulerDraw';
import { frameToTicks } from '~/timeline/commands/utils';
import { ticksToPx } from '~/utils/timeline/geometry';

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

  it('keeps ruler ticks aligned to global frame positions for non-integer fps', () => {
    let scheduleDraw: (() => void) | null = null;
    const moveTo = vi.fn();
    const fillText = vi.fn();

    const ctx = {
      setTransform: vi.fn(),
      scale: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo,
      lineTo: vi.fn(),
      fillText,
      stroke: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      font: '',
      textAlign: 'center',
      textBaseline: 'top',
    };

    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
    } as unknown as HTMLCanvasElement;

    const fps = 29.97;
    const zoom = 50;
    const frameAtTenMinutesTimecode = 18_000;
    const tickTicks = frameToTicks(frameAtTenMinutesTimecode, fps);
    const tickAbsPx = ticksToPx(tickTicks, zoom);
    const scrollLeft = tickAbsPx - 100;

    const TestComponent = defineComponent({
      setup() {
        const api = useTimelineRulerDraw({
          containerRef: ref(null),
          canvasRef: ref(canvas),
          width: ref(400),
          height: ref(40),
          scrollLeft: ref(scrollLeft),
          zoom: ref(zoom),
          fps: ref(fps),
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

    const renderStartPx = Math.max(0, scrollLeft - 512);
    const expectedCanvasX = Math.round(tickAbsPx) - renderStartPx + 0.5;
    const oldRealSecondCanvasX = Math.round(ticksToPx(600_000_000, zoom)) - renderStartPx + 0.5;
    const majorTickXs = fillText.mock.calls.map((call) => call[1]);

    expect(majorTickXs).toContain(expectedCanvasX);
    expect(majorTickXs).not.toContain(oldRealSecondCanvasX);
    expect(Math.abs(expectedCanvasX - oldRealSecondCanvasX)).toBeGreaterThan(5);

    wrapper.unmount();
  });
});
