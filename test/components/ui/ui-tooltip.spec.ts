import { describe, it, expect } from 'vitest';
import { nextTick } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiTooltip from '~/components/ui/UiTooltip.vue';

const stubs = {
  UTooltip: {
    template:
      '<div class="u-tooltip-stub"><slot /><div v-if="open" class="tooltip-content"><slot name="content" /></div></div>',
    props: ['open', 'disabled', 'content', 'delayDuration', 'ui'],
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
        openOnClick: true,
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

  it('shows and hides the tooltip on pointer hover', async () => {
    const component = await mountSuspended(UiTooltip, {
      global: { stubs },
      props: {
        text: 'Hover tooltip',
      },
      slots: {
        default: '<button>Hover target</button>',
      },
    });

    const trigger = component.find('.u-tooltip-stub > span');
    expect(component.find('.tooltip-content').exists()).toBe(false);

    await trigger.trigger('pointerenter');
    expect(component.find('.tooltip-content').text()).toBe('Hover tooltip');

    await trigger.trigger('pointerleave');
    expect(component.find('.tooltip-content').exists()).toBe(false);
  });

  it('pins the tooltip on click when openOnClick is enabled', async () => {
    const component = await mountSuspended(UiTooltip, {
      global: { stubs },
      props: {
        text: 'Tap tooltip',
        openOnClick: true,
      },
      slots: {
        default: '<button>Tap target</button>',
      },
    });

    const trigger = component.find('.u-tooltip-stub > span');

    await trigger.trigger('click');
    expect(component.find('.tooltip-content').text()).toBe('Tap tooltip');

    await trigger.trigger('click');
    expect(component.find('.tooltip-content').exists()).toBe(false);
  });

  it('keeps a clicked tooltip open after hover leaves', async () => {
    const component = await mountSuspended(UiTooltip, {
      global: { stubs },
      props: {
        text: 'Pinned after hover',
        openOnClick: true,
      },
      slots: {
        default: '<button>Info</button>',
      },
    });

    const trigger = component.find('.u-tooltip-stub > span');

    await trigger.trigger('pointerenter');
    await trigger.trigger('click');
    await trigger.trigger('pointerleave');

    expect(component.find('.tooltip-content').text()).toBe('Pinned after hover');
  });

  it('closes a pinned tooltip on Escape and outside pointer down', async () => {
    const component = await mountSuspended(UiTooltip, {
      attachTo: document.body,
      global: { stubs },
      props: {
        text: 'Dismissible tooltip',
        openOnClick: true,
      },
      slots: {
        default: '<button>Info</button>',
      },
    });

    const trigger = component.find('.u-tooltip-stub > span');

    await trigger.trigger('click');
    expect(component.find('.tooltip-content').exists()).toBe(true);

    await trigger.trigger('keydown', { key: 'Escape' });
    expect(component.find('.tooltip-content').exists()).toBe(false);

    await trigger.trigger('click');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();

    expect(component.find('.tooltip-content').exists()).toBe(false);
    component.unmount();
  });

  it('renders multi-line tooltip text through the content slot', async () => {
    const component = await mountSuspended(UiTooltip, {
      global: { stubs },
      props: {
        text: 'First line\nSecond line',
      },
      slots: {
        default: '<button>Info</button>',
      },
    });

    await component.find('.u-tooltip-stub > span').trigger('pointerenter');

    expect(component.find('.tooltip-content').text()).toContain('First line\nSecond line');
  });
});
