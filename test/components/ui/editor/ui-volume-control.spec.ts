import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiVolumeControl from '~/components/ui/editor/UiVolumeControl.vue';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';

describe('UiVolumeControl', () => {
  it('renders correctly in normal mode', async () => {
    const component = await mountSuspended(UiVolumeControl, {
      props: {
        volume: 1,
        isMuted: false,
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.findComponent(UiWheelSlider).exists()).toBe(true);
    expect(component.text()).toContain('100%');
  });

  it('renders correctly in compact mode', async () => {
    const component = await mountSuspended(UiVolumeControl, {
      props: {
        volume: 0.5,
        isMuted: false,
        compact: true,
      },
    });

    expect(component.exists()).toBe(true);
    // In compact mode, the slider is in a popup and might not be rendered initially
    // or is teleported, but the trigger text should be there.
    expect(component.text()).toContain('50%');
  });

  it('displays 0% when muted', async () => {
    const component = await mountSuspended(UiVolumeControl, {
      props: {
        volume: 1,
        isMuted: true,
      },
    });

    expect(component.text()).toContain('0%');
  });

  it('emits update:volume when the slider emits a change', async () => {
    const component = await mountSuspended(UiVolumeControl, {
      props: {
        volume: 1,
        isMuted: false,
      },
    });

    const wheelSlider = component.findComponent(UiWheelSlider);

    await wheelSlider.vm.$emit('update:modelValue', 0.5);

    expect(component.emitted('update:volume')).toBeTruthy();
    expect(component.emitted('update:volume')?.[0]).toEqual([0.5]);
  });

  it('passes max prop correctly to the underlying slider', async () => {
    const component = await mountSuspended(UiVolumeControl, {
      props: {
        volume: 0.5,
        isMuted: false,
        max: 2.0,
      },
    });

    const wheelSlider = component.findComponent(UiWheelSlider);
    expect(wheelSlider.props('max')).toBe(2.0);
  });

  it('toggles mute state when clicking the speaker button in normal mode', async () => {
    const component = await mountSuspended(UiVolumeControl, {
      props: {
        volume: 1,
        isMuted: false,
      },
    });

    const buttons = component.findAll('button');
    const toggleButton = buttons[0];

    await toggleButton.trigger('click');
    expect(component.emitted('update:isMuted')).toBeTruthy();
    expect(component.emitted('update:isMuted')?.[0]).toEqual([true]);
  });

  it('toggles mute state when clicking the percentage span in compact mode', async () => {
    const component = await mountSuspended(UiVolumeControl, {
      props: {
        volume: 0.8,
        isMuted: true,
        compact: true,
      },
    });

    // The span with the text acts as the trigger in compact mode
    const textSpan = component.find('span.tabular-nums');
    expect(textSpan.exists()).toBe(true);

    await textSpan.trigger('click');
    expect(component.emitted('update:isMuted')).toBeTruthy();
    expect(component.emitted('update:isMuted')?.[0]).toEqual([false]);
  });
});
