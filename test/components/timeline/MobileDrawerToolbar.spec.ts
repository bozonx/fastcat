import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileDrawerToolbar from '~/components/timeline/MobileDrawerToolbar.vue';

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('MobileDrawerToolbar', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', MockResizeObserver);
  });

  it('renders slot content', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbar, {
      slots: { default: '<button class="item">A</button>' },
    });

    expect(wrapper.find('.item').exists()).toBe(true);
  });

  it('uses horizontal layout by default', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbar);
    expect(wrapper.find('.mobile-drawer-toolbar--horizontal').exists()).toBe(true);
    expect(wrapper.find('.mobile-drawer-toolbar--vertical').exists()).toBe(false);
  });

  it('switches to vertical layout when requested', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbar, {
      props: { orientation: 'vertical' },
    });
    expect(wrapper.find('.mobile-drawer-toolbar--vertical').exists()).toBe(true);
    expect(wrapper.find('.mobile-drawer-toolbar--horizontal').exists()).toBe(false);
  });

  it('observes the scroll container on mount and disconnects on unmount', async () => {
    const observeSpy = vi.spyOn(MockResizeObserver.prototype, 'observe');
    const disconnectSpy = vi.spyOn(MockResizeObserver.prototype, 'disconnect');

    const wrapper = await mountSuspended(MobileDrawerToolbar, {
      slots: { default: '<button>A</button>' },
    });

    expect(observeSpy).toHaveBeenCalled();

    wrapper.unmount();
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it('reveals the end shadow when content overflows horizontally', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbar, {
      slots: { default: '<button>A</button>' },
    });

    const scroller = wrapper.find('.scroll-smooth').element as HTMLElement;
    Object.defineProperty(scroller, 'scrollLeft', { value: 0, configurable: true });
    Object.defineProperty(scroller, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 100, configurable: true });

    await wrapper.find('.scroll-smooth').trigger('scroll');

    const shadows = wrapper.findAll('.absolute.z-10');
    // End shadow (second) should be visible, start shadow (first) hidden.
    expect(shadows[0]!.classes()).toContain('opacity-0');
    expect(shadows[1]!.classes()).toContain('opacity-100');
  });

  it('reveals the start shadow after scrolling away from the start', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbar, {
      slots: { default: '<button>A</button>' },
    });

    const scroller = wrapper.find('.scroll-smooth').element as HTMLElement;
    Object.defineProperty(scroller, 'scrollLeft', { value: 50, configurable: true });
    Object.defineProperty(scroller, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(scroller, 'clientWidth', { value: 500, configurable: true });

    await wrapper.find('.scroll-smooth').trigger('scroll');

    const shadows = wrapper.findAll('.absolute.z-10');
    expect(shadows[0]!.classes()).toContain('opacity-100');
    expect(shadows[1]!.classes()).toContain('opacity-0');
  });
});
