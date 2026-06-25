import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import FriendlyTime from '~/components/ui/FriendlyTime.vue';

describe('FriendlyTime', () => {
  it('renders fallback when date is null', async () => {
    const component = await mountSuspended(FriendlyTime, {
      props: { date: null },
    });

    expect(component.text()).toBe('—');
  });

  it('renders custom fallback', async () => {
    const component = await mountSuspended(FriendlyTime, {
      props: { date: null, fallback: 'N/A' },
    });

    expect(component.text()).toBe('N/A');
  });

  it('renders fallback for invalid date string', async () => {
    const component = await mountSuspended(FriendlyTime, {
      props: { date: 'not-a-date' },
    });

    expect(component.text()).toBe('—');
  });

  it('renders a time string for a valid date', async () => {
    const now = Date.now();
    const component = await mountSuspended(FriendlyTime, {
      props: { date: now },
    });

    expect(component.text()).not.toBe('—');
    expect(component.text().length).toBeGreaterThan(0);
  });

  it('renders a time string for a Date object', async () => {
    const component = await mountSuspended(FriendlyTime, {
      props: { date: new Date() },
    });

    expect(component.text()).not.toBe('—');
  });

  it('renders a span element', async () => {
    const component = await mountSuspended(FriendlyTime, {
      props: { date: null },
    });

    expect(component.find('span').exists()).toBe(true);
  });
});
