import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiTooltip from '~/components/ui/UiTooltip.vue';

const stubs = {
  UTooltip: {
    template: '<div><slot /></div>',
    props: ['text', 'placement', 'prevent'],
  },
};

describe('UiTooltip', () => {
  it('renders default slot content', async () => {
    const component = await mountSuspended(UiTooltip, {
      global: { stubs },
      slots: {
        default: '<div class="target-element">Hover Me</div>',
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.find('.target-element').exists()).toBe(true);
    expect(component.text()).toContain('Hover Me');
  });

  it('mounts with custom props without errors', async () => {
    const component = await mountSuspended(UiTooltip, {
      global: { stubs },
      props: {
        text: 'Information tooltip text',
        placement: 'right',
        disabled: true,
      },
      slots: {
        default: '<button>Action</button>',
      },
    });

    expect(component.exists()).toBe(true);
    // The slot content should still be rendered regardless of tooltip props
    expect(component.find('button').text()).toBe('Action');
  });

  it('mounts with default props without errors', async () => {
    const component = await mountSuspended(UiTooltip, {
      global: { stubs },
      slots: {
        default: '<span>Default Tooltip</span>',
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.text()).toContain('Default Tooltip');
  });
});
