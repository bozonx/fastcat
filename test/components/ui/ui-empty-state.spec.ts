import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiEmptyState from '~/components/ui/UiEmptyState.vue';

describe('UiEmptyState', () => {
  it('renders message', async () => {
    const component = await mountSuspended(UiEmptyState, {
      props: {
        message: 'No items found',
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('No items found');
  });

  it('renders icon when provided', async () => {
    const component = await mountSuspended(UiEmptyState, {
      props: {
        message: 'No items',
        icon: 'i-heroicons-inbox',
      },
    });

    expect(component.find('.icon-mock').exists()).toBe(true);
  });

  it('does not render icon when not provided', async () => {
    const component = await mountSuspended(UiEmptyState, {
      props: {
        message: 'No items',
      },
    });

    expect(component.find('.icon-mock').exists()).toBe(false);
  });

  it('applies custom wrapperClass', async () => {
    const component = await mountSuspended(UiEmptyState, {
      props: {
        message: 'No items',
        wrapperClass: 'custom-wrapper',
      },
    });

    expect(component.find('.custom-wrapper').exists()).toBe(true);
  });

  it('applies custom iconClass', async () => {
    const component = await mountSuspended(UiEmptyState, {
      props: {
        message: 'No items',
        icon: 'i-heroicons-inbox',
        iconClass: 'w-8 h-8 custom-icon',
      },
    });

    const icon = component.find('.icon-mock');
    expect(icon.exists()).toBe(true);
  });
});
