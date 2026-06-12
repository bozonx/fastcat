import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveNativeMonitorCanvasSize,
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

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
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

describe('useNativeMonitorCanvas', () => {
  beforeEach(() => {
    invokeMock.mockClear();
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
    let receivedBuffer: ArrayBuffer | null = null;

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
});
