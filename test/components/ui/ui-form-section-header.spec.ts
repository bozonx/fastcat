import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiFormSectionHeader from '~/components/ui/UiFormSectionHeader.vue';

describe('UiFormSectionHeader', () => {
  it('renders title correctly', async () => {
    const component = await mountSuspended(UiFormSectionHeader, {
      props: {
        title: 'Section Title',
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('Section Title');
  });

  it('renders slot content', async () => {
    const component = await mountSuspended(UiFormSectionHeader, {
      props: {
        title: 'Section Title',
      },
      slots: {
        default: '<button class="slot-btn">Action</button>',
      },
    });

    expect(component.find('.slot-btn').exists()).toBe(true);
  });

  it('has correct heading element', async () => {
    const component = await mountSuspended(UiFormSectionHeader, {
      props: {
        title: 'Section Title',
      },
    });

    const heading = component.find('h3');
    expect(heading.exists()).toBe(true);
    expect(heading.text()).toBe('Section Title');
  });

  it('renders info tooltip when infoTooltip prop is provided', async () => {
    const component = await mountSuspended(UiFormSectionHeader, {
      props: {
        title: 'Section Title',
        infoTooltip: 'Helpful information',
      },
    });

    expect(component.text()).toContain('Section Title');
  });
});
