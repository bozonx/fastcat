import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ref } from 'vue';
import MarkerColorFilter from '~/components/project/MarkerColorFilter.vue';

describe('MarkerColorFilter', () => {
  it('renders color buttons for each available color', async () => {
    const selectedColors = ref(new Set<string>());
    const component = await mountSuspended(MarkerColorFilter, {
      props: {
        availableColors: ['#ff0000', '#00ff00', '#0000ff'],
        modelValue: selectedColors.value,
      },
    });

    const buttons = component.findAll('.marker-color-filter button');
    expect(buttons.length).toBe(3);
  });

  it('shows checkmark for selected colors', async () => {
    const selectedColors = ref(new Set(['#ff0000']));
    const component = await mountSuspended(MarkerColorFilter, {
      props: {
        availableColors: ['#ff0000', '#00ff00'],
        modelValue: selectedColors.value,
      },
    });

    const buttons = component.findAll('.marker-color-filter button');
    const checkmarks = component.findAll('.marker-color-filter span');
    expect(checkmarks.length).toBe(1);
  });

  it('toggles color when clicked', async () => {
    const selectedColors = ref(new Set<string>());
    const component = await mountSuspended(MarkerColorFilter, {
      props: {
        availableColors: ['#ff0000', '#00ff00'],
        modelValue: selectedColors.value,
        'onUpdate:modelValue': (val: Set<string>) => {
          selectedColors.value = val;
        },
      },
    });

    const buttons = component.findAll('.marker-color-filter button');
    await buttons[0].trigger('click');

    expect(component.emitted('update:modelValue')).toBeTruthy();
  });

  it('renders select all button when colors are available', async () => {
    const component = await mountSuspended(MarkerColorFilter, {
      props: {
        availableColors: ['#ff0000'],
        modelValue: new Set<string>(),
      },
    });

    expect(component.text()).toContain('fastcat.marker.selectAll');
  });

  it('does not render select all button when no colors', async () => {
    const component = await mountSuspended(MarkerColorFilter, {
      props: {
        availableColors: [],
        modelValue: new Set<string>(),
      },
    });

    expect(component.text()).not.toContain('fastcat.marker.selectAll');
  });

  it('applies vertical layout when orientation is vertical', async () => {
    const component = await mountSuspended(MarkerColorFilter, {
      props: {
        availableColors: ['#ff0000'],
        modelValue: new Set<string>(),
        orientation: 'vertical',
      },
    });

    const wrapper = component.find('.marker-color-filter');
    expect(wrapper.classes()).toContain('flex-col');
  });

  it('applies horizontal layout by default', async () => {
    const component = await mountSuspended(MarkerColorFilter, {
      props: {
        availableColors: ['#ff0000'],
        modelValue: new Set<string>(),
      },
    });

    const wrapper = component.find('.marker-color-filter');
    expect(wrapper.classes()).not.toContain('flex-col');
  });
});
