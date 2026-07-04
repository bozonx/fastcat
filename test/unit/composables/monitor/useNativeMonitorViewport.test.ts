import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { useNativeMonitorViewport } from '~/composables/monitor/useNativeMonitorViewport';
import { nativeMonitorIpc } from '~/composables/monitor/native-monitor-ipc';
import * as runtimeUtils from '~/utils/runtime';
import * as availability from '~/composables/monitor/native-monitor-availability';

vi.mock('~/composables/monitor/native-monitor-ipc', () => ({
  nativeMonitorIpc: {
    setViewport: vi.fn().mockResolvedValue(undefined),
  },
}));

class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

class MockIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

describe('useNativeMonitorViewport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(availability, 'isNativeMonitorDisabled').mockReturnValue(false);
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  it('bails out early if not in Tauri runtime', () => {
    vi.spyOn(runtimeUtils, 'isTauriRuntime').mockReturnValue(false);
    const elRef = ref<HTMLElement | null>(null);

    const TestComponent = defineComponent({
      setup() {
        useNativeMonitorViewport(elRef);
        return () => h('div');
      },
    });

    mount(TestComponent);
    expect(nativeMonitorIpc.setViewport).not.toHaveBeenCalled();
  });

  it('computes and dispatches viewport payload when element is present in Tauri', () => {
    vi.spyOn(runtimeUtils, 'isTauriRuntime').mockReturnValue(true);

    const mockEl = {
      getBoundingClientRect: () => ({
        left: 100,
        top: 50,
        width: 640,
        height: 360,
      }),
    } as unknown as HTMLElement;

    const elRef = ref<HTMLElement | null>(mockEl);

    const TestComponent = defineComponent({
      setup() {
        useNativeMonitorViewport(elRef);
        return () => h('div');
      },
    });

    mount(TestComponent);

    expect(nativeMonitorIpc.setViewport).toHaveBeenCalledWith(
      expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      }),
    );
  });
});
