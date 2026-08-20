import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import LoadingScreen from '~/components/startup/LoadingScreen.vue';

describe('LoadingScreen', () => {
  it('renders loading icon and text', async () => {
    const component = await mountSuspended(LoadingScreen);

    expect(component.exists()).toBe(true);
    expect(component.find('.icon-mock').exists()).toBe(true);
    expect(component.text()).toContain('common.loading');
  });

  it('has spin animation on icon', async () => {
    const component = await mountSuspended(LoadingScreen);

    const icon = component.find('.icon-mock');
    expect(icon.exists()).toBe(true);
    expect(icon.classes()).toContain('animate-spin');
  });

  it('uses flex column layout', async () => {
    const component = await mountSuspended(LoadingScreen);

    const wrapper = component.find('div');
    expect(wrapper.classes()).toContain('flex-col');
  });
});
