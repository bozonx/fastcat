import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiMobileDrawerButton from '~/components/ui/UiMobileDrawerButton.vue';

const globalOptions = {
  stubs: {
    UIcon: {
      props: ['name'],
      template: '<i :data-icon="name" />',
    },
  },
};

describe('UiMobileDrawerButton', () => {
  it('renders the icon and label', async () => {
    const wrapper = await mountSuspended(UiMobileDrawerButton, {
      props: { icon: 'lucide:trash', label: 'Delete' },
      global: globalOptions,
    });

    expect(wrapper.find('[data-icon="lucide:trash"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Delete');
  });

  it('emits a click event when pressed', async () => {
    const wrapper = await mountSuspended(UiMobileDrawerButton, {
      props: { label: 'Tap' },
      global: globalOptions,
    });

    await wrapper.find('button').trigger('click');
    expect(wrapper.emitted('click')).toHaveLength(1);
  });

  it('applies danger variant classes', async () => {
    const wrapper = await mountSuspended(UiMobileDrawerButton, {
      props: { variant: 'danger', label: 'X' },
      global: globalOptions,
    });

    expect(wrapper.find('button').classes().join(' ')).toContain('text-red-400');
  });

  it('applies primary variant classes', async () => {
    const wrapper = await mountSuspended(UiMobileDrawerButton, {
      props: { variant: 'primary', label: 'X' },
      global: globalOptions,
    });

    expect(wrapper.find('button').classes().join(' ')).toContain('text-primary-400');
  });

  it('shows active state styling when active and neutral', async () => {
    const wrapper = await mountSuspended(UiMobileDrawerButton, {
      props: { active: true, label: 'X' },
      global: globalOptions,
    });

    expect(wrapper.find('button').classes().join(' ')).toContain('text-primary-400');
  });

  it('applies disabled styling and takes priority over the variant', async () => {
    const wrapper = await mountSuspended(UiMobileDrawerButton, {
      props: { variant: 'danger', disabled: true, label: 'X' },
      global: globalOptions,
    });

    const classes = wrapper.find('button').classes().join(' ');
    expect(classes).toContain('pointer-events-none');
    expect(classes).toContain('opacity-40');
    expect(classes).not.toContain('text-red-400');
  });

  it('omits icon and label markup when not provided', async () => {
    const wrapper = await mountSuspended(UiMobileDrawerButton, {
      global: globalOptions,
    });

    expect(wrapper.find('i').exists()).toBe(false);
    expect(wrapper.find('span').exists()).toBe(false);
  });
});
