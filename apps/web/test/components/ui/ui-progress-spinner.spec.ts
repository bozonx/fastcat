import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiProgressSpinner from '~/components/ui/UiProgressSpinner.vue';

describe('UiProgressSpinner', () => {
  it('renders correctly', async () => {
    const component = await mountSuspended(UiProgressSpinner, {
      props: {
        progress: 50,
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.find('svg').exists()).toBe(true);
    expect(component.findAll('circle').length).toBe(2);
  });

  it('applies default size class when size prop is not provided', async () => {
    const component = await mountSuspended(UiProgressSpinner, {
      props: {
        progress: 0,
      },
    });

    expect(component.find('svg').classes()).toContain('w-4');
    expect(component.find('svg').classes()).toContain('h-4');
  });

  it('applies correct size classes for sm', async () => {
    const component = await mountSuspended(UiProgressSpinner, {
      props: {
        progress: 0,
        size: 'sm',
      },
    });

    expect(component.find('svg').classes()).toContain('w-4');
    expect(component.find('svg').classes()).toContain('h-4');
  });

  it('applies correct size classes for md', async () => {
    const component = await mountSuspended(UiProgressSpinner, {
      props: {
        progress: 0,
        size: 'md',
      },
    });

    expect(component.find('svg').classes()).toContain('w-6');
    expect(component.find('svg').classes()).toContain('h-6');
  });

  it('applies correct size classes for lg', async () => {
    const component = await mountSuspended(UiProgressSpinner, {
      props: {
        progress: 0,
        size: 'lg',
      },
    });

    expect(component.find('svg').classes()).toContain('w-8');
    expect(component.find('svg').classes()).toContain('h-8');
  });

  it('calculates the correct stroke-dashoffset for 0% progress', async () => {
    const component = await mountSuspended(UiProgressSpinner, {
      props: {
        progress: 0,
      },
    });

    const circles = component.findAll('circle');
    const progressCircle = circles[1];

    // 37.7 - (37.7 * 0) / 100 = 37.7
    expect(progressCircle.attributes('stroke-dashoffset')).toBe('37.7');
  });

  it('calculates the correct stroke-dashoffset for 50% progress', async () => {
    const component = await mountSuspended(UiProgressSpinner, {
      props: {
        progress: 50,
      },
    });

    const circles = component.findAll('circle');
    const progressCircle = circles[1];

    // 37.7 - (37.7 * 50) / 100 = 37.7 - 18.85 = 18.85
    expect(progressCircle.attributes('stroke-dashoffset')).toBe('18.85');
  });

  it('calculates the correct stroke-dashoffset for 100% progress', async () => {
    const component = await mountSuspended(UiProgressSpinner, {
      props: {
        progress: 100,
      },
    });

    const circles = component.findAll('circle');
    const progressCircle = circles[1];

    // 37.7 - (37.7 * 100) / 100 = 0
    expect(progressCircle.attributes('stroke-dashoffset')).toBe('0');
  });
});
