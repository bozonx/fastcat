import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiAccordion from '~/components/ui/UiAccordion.vue';

describe('UiAccordion', () => {
  it('renders correctly when collapsed', async () => {
    const component = await mountSuspended(UiAccordion, {
      props: {
        title: 'Test Title',
        summary: 'Test Summary',
      },
      slots: {
        default: '<div class="accordion-content">Content</div>',
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.find('h3').isVisible()).toBe(false);
    expect(component.find('span').isVisible()).toBe(true);
    expect(component.find('.accordion-content').isVisible()).toBe(false);
    expect(component.find('span').text()).toBe('Test Summary');
  });

  it('renders title and content when expanded', async () => {
    const component = await mountSuspended(UiAccordion, {
      props: {
        title: 'Test Title',
        summary: 'Test Summary',
        open: true,
      },
      slots: {
        default: '<div class="accordion-content">Content</div>',
      },
    });

    expect(component.find('h3').isVisible()).toBe(true);
    expect(component.find('h3').text()).toBe('Test Title');
    expect(component.find('span').isVisible()).toBe(false);
    expect(component.find('.accordion-content').isVisible()).toBe(true);
  });

  it('toggles open state on button click', async () => {
    const component = await mountSuspended(UiAccordion, {
      props: {
        title: 'Test Title',
        summary: 'Test Summary',
      },
      slots: {
        default: '<div class="accordion-content">Content</div>',
      },
    });

    expect(component.find('.accordion-content').isVisible()).toBe(false);

    await component.find('button').trigger('click');
    await component.vm.$nextTick();

    expect(component.find('.accordion-content').isVisible()).toBe(true);
    expect(component.find('h3').isVisible()).toBe(true);
  });

  it('uses defaultOpen prop when no v-model is provided', async () => {
    const component = await mountSuspended(UiAccordion, {
      props: {
        title: 'Test Title',
        defaultOpen: true,
      },
      slots: {
        default: '<div class="accordion-content">Content</div>',
      },
    });

    expect(component.find('.accordion-content').isVisible()).toBe(true);
    expect(component.find('h3').isVisible()).toBe(true);
  });

  it('falls back to title when summary is not provided', async () => {
    const component = await mountSuspended(UiAccordion, {
      props: {
        title: 'Only Title',
      },
    });

    expect(component.find('span').isVisible()).toBe(true);
    expect(component.find('span').text()).toBe('Only Title');
  });

  it('updates v-model:open on toggle', async () => {
    const component = await mountSuspended(UiAccordion, {
      props: {
        title: 'Test',
        open: false,
      },
    });

    await component.find('button').trigger('click');

    expect(component.emitted('update:open')).toBeTruthy();
    expect(component.emitted('update:open')![0]).toEqual([true]);
  });
});
