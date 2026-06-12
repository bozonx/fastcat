import { describe, it, expect, vi } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import MarkerColorFilter from '~/components/project/MarkerColorFilter.vue';
import { ref } from 'vue';

describe('MarkerColorFilter.vue', () => {
  it('renders available colors', async () => {
    const selectedColors = ref(new Set<string>(['#d0021b']));
    const component = await mountWithNuxt(MarkerColorFilter, {
      props: {
        availableColors: ['#d0021b', '#4a90e2'],
        modelValue: selectedColors.value,
        'onUpdate:modelValue': (val: Set<string>) => {
          selectedColors.value = val;
        },
      },
    });

    const buttons = component.findAll('button');
    // 2 color buttons + 1 "Select all" button
    expect(buttons.length).toBe(3);

    const redButton = buttons.find((btn) => btn.attributes('style')?.includes('#d0021b'));
    const blueButton = buttons.find((btn) => btn.attributes('style')?.includes('#4a90e2'));

    expect(redButton).toBeDefined();
    expect(blueButton).toBeDefined();
  });

  it('applies selected styling and checkmarks', async () => {
    const selectedColors = ref(new Set<string>(['#d0021b']));
    const component = await mountWithNuxt(MarkerColorFilter, {
      props: {
        availableColors: ['#d0021b', '#4a90e2'],
        modelValue: selectedColors.value,
        'onUpdate:modelValue': (val: Set<string>) => {
          selectedColors.value = val;
        },
      },
    });

    const redButton = component.findAll('button').find((btn) => btn.attributes('style')?.includes('#d0021b'));
    const blueButton = component.findAll('button').find((btn) => btn.attributes('style')?.includes('#4a90e2'));

    expect(redButton!.classes()).toContain('opacity-100');
    expect(redButton!.classes()).toContain('ring-2');
    expect(redButton!.text()).toContain('✓');

    expect(blueButton!.classes()).toContain('opacity-40');
    expect(blueButton!.classes()).not.toContain('ring-2');
    expect(blueButton!.text()).not.toContain('✓');
  });

  it('toggles selection when color button is clicked', async () => {
    const selectedColors = ref(new Set<string>(['#d0021b']));
    const component = await mountWithNuxt(MarkerColorFilter, {
      props: {
        availableColors: ['#d0021b', '#4a90e2'],
        modelValue: selectedColors.value,
        'onUpdate:modelValue': (val: Set<string>) => {
          selectedColors.value = val;
        },
      },
    });

    const blueButton = component.findAll('button').find((btn) => btn.attributes('style')?.includes('#4a90e2'));
    await blueButton!.trigger('click');
    await component.setProps({ modelValue: selectedColors.value });

    expect(selectedColors.value.has('#4a90e2')).toBe(true);
    expect(selectedColors.value.has('#d0021b')).toBe(true);

    const redButton = component.findAll('button').find((btn) => btn.attributes('style')?.includes('#d0021b'));
    await redButton!.trigger('click');
    await component.setProps({ modelValue: selectedColors.value });
    expect(selectedColors.value.has('#d0021b')).toBe(false);
  });

  it('toggles all colors with Select all button', async () => {
    const selectedColors = ref(new Set<string>(['#d0021b']));
    const component = await mountWithNuxt(MarkerColorFilter, {
      props: {
        availableColors: ['#d0021b', '#4a90e2'],
        modelValue: selectedColors.value,
        'onUpdate:modelValue': (val: Set<string>) => {
          selectedColors.value = val;
        },
      },
    });

    const selectAllBtn = component.findAll('button').find((btn) => btn.text().includes('fastcat.marker.selectAll'));
    expect(selectAllBtn).toBeDefined();

    // Currently not all selected (only red), so clicking should select all
    await selectAllBtn!.trigger('click');
    await component.setProps({ modelValue: selectedColors.value });
    expect(selectedColors.value.size).toBe(2);
    expect(selectedColors.value.has('#d0021b')).toBe(true);
    expect(selectedColors.value.has('#4a90e2')).toBe(true);

    // All are selected now, so clicking should clear selection
    await selectAllBtn!.trigger('click');
    await component.setProps({ modelValue: selectedColors.value });
    expect(selectedColors.value.size).toBe(0);
  });
});
