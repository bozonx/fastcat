import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import { useAppFullscreen } from '~/composables/useAppFullscreen';

const { getCurrentWindowMock } = vi.hoisted(() => ({
  getCurrentWindowMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: getCurrentWindowMock,
}));

describe('useAppFullscreen', () => {
  beforeEach(() => {
    getCurrentWindowMock.mockClear();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  });

  it('uses local fullscreen state in Tauri without fullscreening the app window', async () => {
    const TestComponent = defineComponent({
      setup() {
        return useAppFullscreen();
      },
      template: '<button @click="enter">{{ String(isFullscreen) }}</button>',
    });

    const wrapper = mount(TestComponent);

    expect(wrapper.text()).toBe('false');

    await wrapper.find('button').trigger('click');

    expect(wrapper.text()).toBe('true');
    expect(getCurrentWindowMock).not.toHaveBeenCalled();
  });
});
