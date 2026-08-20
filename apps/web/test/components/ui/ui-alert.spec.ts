import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiAlert from '~/components/ui/UiAlert.vue';

describe('UiAlert', () => {
  it('renders slot content', async () => {
    const component = await mountSuspended(UiAlert, {
      slots: { default: '<p class="alert-msg">Important info</p>' },
    });

    expect(component.exists()).toBe(true);
    expect(component.find('.alert-msg').exists()).toBe(true);
    expect(component.text()).toContain('Important info');
  });

  it('renders icon when provided', async () => {
    const component = await mountSuspended(UiAlert, {
      props: { icon: 'i-heroicons-exclamation-triangle' },
      slots: { default: 'Warning text' },
    });

    expect(component.find('.icon-mock').exists()).toBe(true);
  });

  it('does not render icon when icon prop is empty string', async () => {
    const component = await mountSuspended(UiAlert, {
      props: { icon: '' },
      slots: { default: 'No icon alert' },
    });

    expect(component.find('.icon-mock').exists()).toBe(false);
  });

  it('applies correct icon color class for warning variant', async () => {
    const component = await mountSuspended(UiAlert, {
      props: { variant: 'warning', icon: 'i-heroicons-exclamation' },
      slots: { default: 'Warning' },
    });

    expect(component.find('.icon-mock').classes()).toContain('text-amber-500');
  });

  it('applies correct icon color class for error variant', async () => {
    const component = await mountSuspended(UiAlert, {
      props: { variant: 'error', icon: 'i-heroicons-x-circle' },
      slots: { default: 'Error' },
    });

    expect(component.find('.icon-mock').classes()).toContain('text-red-500');
  });

  it('applies correct icon color class for success variant', async () => {
    const component = await mountSuspended(UiAlert, {
      props: { variant: 'success', icon: 'i-heroicons-check-circle' },
      slots: { default: 'Success' },
    });

    expect(component.find('.icon-mock').classes()).toContain('text-emerald-500');
  });

  it('applies correct icon color class for info variant (default)', async () => {
    const component = await mountSuspended(UiAlert, {
      props: { variant: 'info', icon: 'i-heroicons-information-circle' },
      slots: { default: 'Info' },
    });

    expect(component.find('.icon-mock').classes()).toContain('text-primary-500');
  });

  it('uses default icon when not specified', async () => {
    const component = await mountSuspended(UiAlert, {
      slots: { default: 'Default icon' },
    });

    expect(component.find('.icon-mock').exists()).toBe(true);
  });
});
