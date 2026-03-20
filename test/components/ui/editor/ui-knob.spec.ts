import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiKnob from '~/components/ui/editor/UiKnob.vue';

describe('UiKnob', () => {
  it('renders correctly', async () => {
    const component = await mountSuspended(UiKnob, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
      },
    });

    expect(component.exists()).toBe(true);
    expect(component.classes()).toContain('rounded-full');
  });

  it('applies the correct size classes', async () => {
    const componentMd = await mountSuspended(UiKnob, {
      props: { modelValue: 50, min: 0, max: 100, size: 'md' },
    });
    expect(componentMd.classes()).toContain('w-8');
    expect(componentMd.classes()).toContain('h-8');

    const componentSm = await mountSuspended(UiKnob, {
      props: { modelValue: 50, min: 0, max: 100, size: 'sm' },
    });
    expect(componentSm.classes()).toContain('w-6');
    expect(componentSm.classes()).toContain('h-6');

    const componentLg = await mountSuspended(UiKnob, {
      props: { modelValue: 50, min: 0, max: 100, size: 'lg' },
    });
    expect(componentLg.classes()).toContain('w-12');
    expect(componentLg.classes()).toContain('h-12');
  });

  it('calculates the correct rotation angle', async () => {
    const component = await mountSuspended(UiKnob, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
      },
    });

    // 50% = 0 degrees (from -135 to +135)
    const indicator = component.find('div.absolute.w-full.h-full');
    expect(indicator.attributes('style')).toContain('rotate(0deg)');
  });

  it('updates value on pointer drag', async () => {
    const component = await mountSuspended(UiKnob, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
      },
    });

    // Setup mock pointer capture functions since jsdom doesn't support them out of the box
    if (!component.element.setPointerCapture) {
      component.element.setPointerCapture = vi.fn();
    }
    if (!component.element.releasePointerCapture) {
      component.element.releasePointerCapture = vi.fn();
    }

    await component.trigger('pointerdown', { button: 0, pointerType: 'mouse', clientY: 100 });
    await component.trigger('pointermove', { clientY: 90 }); // Dragged up by 10 pixels

    // 10 pixels up means 10% increase of 100 range -> 60
    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]).toEqual([60]);

    await component.trigger('pointerup');
  });

  it('resets to defaultValue on double click', async () => {
    const component = await mountSuspended(UiKnob, {
      props: {
        modelValue: 80,
        min: 0,
        max: 100,
        defaultValue: 50,
      },
    });

    await component.trigger('dblclick');

    expect(component.emitted('update:modelValue')).toBeTruthy();
    expect(component.emitted('update:modelValue')?.[0]).toEqual([50]);
  });

  it('does not reset to defaultValue if not provided on double click', async () => {
    const component = await mountSuspended(UiKnob, {
      props: {
        modelValue: 80,
        min: 0,
        max: 100,
      },
    });

    await component.trigger('dblclick');
    expect(component.emitted('update:modelValue')).toBeFalsy();
  });

  it('does not respond to interactions when disabled', async () => {
    const component = await mountSuspended(UiKnob, {
      props: {
        modelValue: 50,
        min: 0,
        max: 100,
        disabled: true,
        defaultValue: 25,
      },
    });

    await component.trigger('pointerdown', { button: 0, pointerType: 'mouse', clientY: 100 });
    await component.trigger('pointermove', { clientY: 90 });
    expect(component.emitted('update:modelValue')).toBeFalsy();

    await component.trigger('dblclick');
    expect(component.emitted('update:modelValue')).toBeFalsy();
  });
});
