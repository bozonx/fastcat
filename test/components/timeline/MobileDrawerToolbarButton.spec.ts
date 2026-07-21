import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileDrawerToolbarButton from '~/components/timeline/MobileDrawerToolbarButton.vue';

const globalOptions = {
  stubs: {
    UIcon: {
      props: ['name'],
      template: '<i :data-icon="name" />',
    },
  },
};

describe('MobileDrawerToolbarButton', () => {
  it('renders the icon and exposes the label for accessibility', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'lucide:scissors', label: 'Cut' },
      global: globalOptions,
    });

    expect(wrapper.find('[data-icon="lucide:scissors"]').exists()).toBe(true);
    expect(wrapper.find('button').attributes('aria-label')).toBe('Cut');
    expect(wrapper.find('button').attributes('title')).toBe('Cut');
  });

  it('emits a click event when pressed', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'lucide:scissors' },
      global: globalOptions,
    });

    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  it('applies danger styling', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'x', danger: true },
      global: globalOptions,
    });
    expect(wrapper.find('button').classes().join(' ')).toContain('text-red-400');
  });

  it('applies success styling', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'x', success: true },
      global: globalOptions,
    });
    expect(wrapper.find('button').classes().join(' ')).toContain('bg-ui-action');
  });

  it('applies primary styling', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'x', primary: true },
      global: globalOptions,
    });
    expect(wrapper.find('button').classes().join(' ')).toContain('bg-blue-500');
  });

  it('applies active styling', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'x', active: true },
      global: globalOptions,
    });
    expect(wrapper.find('button').classes().join(' ')).toContain('text-blue-400');
  });

  it('applies active styling for muted status', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'x', active: true, status: 'muted' },
      global: globalOptions,
    });
    const buttonClasses = wrapper.find('button').classes().join(' ');
    expect(buttonClasses).toContain('bg-red-500');
    expect(buttonClasses).toContain('text-white');
  });

  it('applies active styling for solo status', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'x', active: true, status: 'solo' },
      global: globalOptions,
    });
    const buttonClasses = wrapper.find('button').classes().join(' ');
    expect(buttonClasses).toContain('bg-green-500');
    expect(buttonClasses).toContain('text-white');
  });

  it('applies active styling for locked status', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'x', active: true, status: 'locked' },
      global: globalOptions,
    });
    const buttonClasses = wrapper.find('button').classes().join(' ');
    expect(buttonClasses).toContain('bg-blue-500');
    expect(buttonClasses).toContain('text-white');
  });

  it('applies active styling for hidden status', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'x', active: true, status: 'hidden' },
      global: globalOptions,
    });
    const buttonClasses = wrapper.find('button').classes().join(' ');
    expect(buttonClasses).toContain('bg-white');
    expect(buttonClasses).toContain('text-black');
  });

  it('applies active styling for disabled status', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'x', active: true, status: 'disabled' },
      global: globalOptions,
    });
    const buttonClasses = wrapper.find('button').classes().join(' ');
    expect(buttonClasses).toContain('bg-white');
    expect(buttonClasses).toContain('text-black');
  });

  it('disables the button and removes the active press animation', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'x', disabled: true },
      global: globalOptions,
    });

    const button = wrapper.find('button');
    expect(button.attributes('disabled')).toBeDefined();
    expect(button.classes().join(' ')).toContain('pointer-events-none');
  });

  it('renders chevron indicator and does not emit chevron on span click', async () => {
    const wrapper = await mountSuspended(MobileDrawerToolbarButton, {
      props: { icon: 'x', withChevron: true, label: 'Delete' },
      global: globalOptions,
    });

    const chevronSpan = wrapper.find('span');
    expect(chevronSpan.exists()).toBe(true);
    await chevronSpan.trigger('click');
    expect(wrapper.emitted('chevron')).toBeUndefined();
  });
});

