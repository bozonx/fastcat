import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobilePullToRefreshIndicator from '~/components/file-manager/MobilePullToRefreshIndicator.vue';

describe('MobilePullToRefreshIndicator', () => {
  it('is hidden when neither pulling nor refreshing', async () => {
    const wrapper = await mountSuspended(MobilePullToRefreshIndicator, {
      props: { isPulling: false, isRefreshing: false, pullDistance: 0 },
    });

    expect(wrapper.find('.iconify').exists()).toBe(false);
  });

  it('shows the arrow icon while pulling', async () => {
    const wrapper = await mountSuspended(MobilePullToRefreshIndicator, {
      props: { isPulling: true, isRefreshing: false, pullDistance: 40 },
    });

    const icon = wrapper.find('.iconify');
    expect(icon.exists()).toBe(true);
    expect(icon.find('path').attributes('d')).toBe('M12 5v14m7-7l-7 7l-7-7');
    expect(icon.classes()).not.toContain('animate-spin');
  });

  it('shows the spinner icon while refreshing', async () => {
    const wrapper = await mountSuspended(MobilePullToRefreshIndicator, {
      props: { isPulling: false, isRefreshing: true, pullDistance: 96 },
    });

    const icon = wrapper.find('.iconify');
    expect(icon.exists()).toBe(true);
    expect(icon.find('path').attributes('d')).toBe('M21 12a9 9 0 1 1-6.219-8.56');
    expect(icon.classes()).toContain('animate-spin');
  });

  it('translates and fades according to pull distance', async () => {
    const wrapper = await mountSuspended(MobilePullToRefreshIndicator, {
      props: { isPulling: true, isRefreshing: false, pullDistance: 24 },
    });

    const style = wrapper.find('div').attributes('style') ?? '';
    expect(style).toContain('translateY(-24px)');
    expect(style).toContain('opacity: 0.5');
  });
});
