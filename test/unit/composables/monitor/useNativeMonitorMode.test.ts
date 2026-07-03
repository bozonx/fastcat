import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveNativeMonitorCanvasSize,
  resolvePlaybackMaxRenderDim,
  useMonitorMode,
  useNativeMonitorCanvas,
} from '~/composables/monitor/useNativeMonitorMode';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {
    onmessage: (data: unknown) => void = () => {};
  },
}));

const resizeObserverInstances: ResizeObserverMock[] = [];

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();

  constructor() {
    resizeObserverInstances.push(this);
  }
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function defineCanvasLayout(el: HTMLCanvasElement): void {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: 640 });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: 360 });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: 640 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 360 });
}

describe('resolveNativeMonitorCanvasSize', () => {
  it('uses layout size before monitor workspace transforms', () => {
    expect(
      resolveNativeMonitorCanvasSize({
        layoutWidth: 960,
        layoutHeight: 540,
        dpr: 1,
      }),
    ).toEqual({ width: 960, height: 540 });
  });

  it('caps the render target while preserving aspect ratio', () => {
    expect(
      resolveNativeMonitorCanvasSize({
        layoutWidth: 1920,
        layoutHeight: 1080,
        dpr: 1,
      }),
    ).toEqual({ width: 960, height: 540 });
  });

  it('keeps valid dimensions for hidden or not-yet-laid-out canvas elements', () => {
    expect(
      resolveNativeMonitorCanvasSize({
        layoutWidth: 0,
        layoutHeight: 0,
        dpr: 2,
      }),
    ).toEqual({ width: 1, height: 1 });
  });
});

describe('resolvePlaybackMaxRenderDim', () => {
  it('falls back to the cheap Auto default when no preview resolution is pinned', () => {
    expect(resolvePlaybackMaxRenderDim({ displayLongEdgePx: 3840, previewResolution: 0 })).toBe(
      960,
    );
  });

  it('respects the user-pinned preview resolution as a fraction of displayed pixels', () => {
    // 1/1 → full displayed long edge (crisp playback, the whole point of the setting).
    expect(resolvePlaybackMaxRenderDim({ displayLongEdgePx: 1600, previewResolution: 1 })).toBe(
      1600,
    );
    // 1/2 → half.
    expect(resolvePlaybackMaxRenderDim({ displayLongEdgePx: 1600, previewResolution: 0.5 })).toBe(
      800,
    );
  });

  it('never exceeds the ceiling (no point rendering beyond a sane maximum)', () => {
    expect(resolvePlaybackMaxRenderDim({ displayLongEdgePx: 8000, previewResolution: 1 })).toBe(
      3840,
    );
  });

  it('never collapses below 1px for a pinned scale on a tiny panel', () => {
    expect(resolvePlaybackMaxRenderDim({ displayLongEdgePx: 1, previewResolution: 0.125 })).toBe(1);
  });
});

describe('useNativeMonitorCanvas', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    resizeObserverInstances.length = 0;
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
    useMonitorMode().set('embedded');
  });

  afterEach(() => {
    useMonitorMode().set('embedded');
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
    vi.unstubAllGlobals();
  });

  it('initializes the native canvas stream when mounted while already in canvas mode', async () => {
    useMonitorMode().set('canvas');

    const TestComponent = defineComponent({
      setup() {
        const canvasRef = ref<HTMLCanvasElement | null>(null);
        useNativeMonitorCanvas(canvasRef);
        return () =>
          h('canvas', {
            ref: (el) => {
              canvasRef.value = el as HTMLCanvasElement | null;
              if (el instanceof HTMLCanvasElement) {
                defineCanvasLayout(el);
              }
            },
          });
      },
    });

    const wrapper = mount(TestComponent, { attachTo: document.body });
    await nextTick();
    await flushPromises();

    expect(invokeMock).toHaveBeenCalledWith('monitor_set_mode', { mode: 'canvas' });
    expect(invokeMock).toHaveBeenCalledWith('monitor_set_canvas_size', {
      width: 640,
      height: 360,
    });
    expect(invokeMock.mock.calls.some(([name]) => name === 'monitor_subscribe_frames')).toBe(true);

    wrapper.unmount();
  });

  it('handles ArrayBufferView with byteOffset and byteLength', async () => {
    useMonitorMode().set('canvas');
    const receivedBuffer: ArrayBuffer | null = null;

    const TestComponent = defineComponent({
      setup() {
        const canvasRef = ref<HTMLCanvasElement | null>(null);
        useNativeMonitorCanvas(canvasRef);
        return () =>
          h('canvas', {
            ref: (el) => {
              canvasRef.value = el as HTMLCanvasElement | null;
              if (el instanceof HTMLCanvasElement) {
                defineCanvasLayout(el);
              }
            },
          });
      },
    });

    const wrapper = mount(TestComponent, { attachTo: document.body });
    await nextTick();
    await flushPromises();

    const subscribeCall = invokeMock.mock.calls.find(
      ([name]) => name === 'monitor_subscribe_frames',
    );
    const channel = subscribeCall?.[1] as { channel: { onmessage: (data: unknown) => void } };
    const handler = channel?.channel?.onmessage;
    expect(handler).toBeDefined();

    const original = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const view = new Uint8Array(original.buffer, 2, 4);
    handler(view);

    wrapper.unmount();
    await nextTick();
    await flushPromises();

    const unsubCall = invokeMock.mock.calls.some(([name]) => name === 'monitor_unsubscribe_frames');
    expect(unsubCall).toBe(true);
  });

  it('unsubscribes the frame stream when switching out of canvas mode', async () => {
    useMonitorMode().set('canvas');

    const TestComponent = defineComponent({
      setup() {
        const canvasRef = ref<HTMLCanvasElement | null>(null);
        useNativeMonitorCanvas(canvasRef);
        return () =>
          h('canvas', {
            ref: (el) => {
              canvasRef.value = el as HTMLCanvasElement | null;
              if (el instanceof HTMLCanvasElement) {
                defineCanvasLayout(el);
              }
            },
          });
      },
    });

    const wrapper = mount(TestComponent, { attachTo: document.body });
    await nextTick();
    await flushPromises();

    expect(invokeMock.mock.calls.some(([name]) => name === 'monitor_subscribe_frames')).toBe(true);

    useMonitorMode().set('embedded');
    await nextTick();
    await flushPromises();

    expect(invokeMock.mock.calls.some(([name]) => name === 'monitor_unsubscribe_frames')).toBe(
      true,
    );

    wrapper.unmount();
  });

  it('rebinds the resize observer when the canvas element changes', async () => {
    useMonitorMode().set('canvas');
    const canvasKey = ref(0);

    const TestComponent = defineComponent({
      setup() {
        const canvasRef = ref<HTMLCanvasElement | null>(null);
        useNativeMonitorCanvas(canvasRef);
        return () =>
          h('canvas', {
            key: canvasKey.value,
            ref: (el) => {
              canvasRef.value = el as HTMLCanvasElement | null;
              if (el instanceof HTMLCanvasElement) {
                defineCanvasLayout(el);
              }
            },
          });
      },
    });

    const wrapper = mount(TestComponent, { attachTo: document.body });
    await nextTick();
    await flushPromises();

    const firstObserver = resizeObserverInstances.at(-1);
    expect(firstObserver?.observe).toHaveBeenCalledTimes(1);

    canvasKey.value += 1;
    await nextTick();
    await flushPromises();

    const secondObserver = resizeObserverInstances.at(-1);
    expect(firstObserver?.disconnect).toHaveBeenCalled();
    expect(secondObserver).not.toBe(firstObserver);
    expect(secondObserver?.observe).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('monitor_set_canvas_size', {
      width: 640,
      height: 360,
    });

    wrapper.unmount();
  });
});
