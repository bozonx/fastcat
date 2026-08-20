import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiAccordion from '~/components/ui/UiAccordion.vue';

function isElementVisible(wrapper: any): boolean {
  let el = wrapper.element;
  while (el) {
    if (el.style?.display === 'none') {
      return false;
    }
    el = el.parentElement;
  }
  return true;
}

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
    expect(isElementVisible(component.find('h3'))).toBe(false);
    expect(isElementVisible(component.find('span'))).toBe(true);
    expect(isElementVisible(component.find('.accordion-content'))).toBe(false);
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

    expect(isElementVisible(component.find('h3'))).toBe(true);
    expect(component.find('h3').text()).toBe('Test Title');
    expect(isElementVisible(component.find('span'))).toBe(false);
    expect(isElementVisible(component.find('.accordion-content'))).toBe(true);
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

    expect(isElementVisible(component.find('.accordion-content'))).toBe(false);

    await component.find('button').trigger('click');
    await component.vm.$nextTick();

    expect(isElementVisible(component.find('.accordion-content'))).toBe(true);
    expect(isElementVisible(component.find('h3'))).toBe(true);
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

    expect(isElementVisible(component.find('.accordion-content'))).toBe(true);
    expect(isElementVisible(component.find('h3'))).toBe(true);
  });

  it('falls back to title when summary is not provided', async () => {
    const component = await mountSuspended(UiAccordion, {
      props: {
        title: 'Only Title',
      },
    });

    expect(isElementVisible(component.find('span'))).toBe(true);
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
