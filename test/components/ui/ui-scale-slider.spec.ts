import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import UiScaleSlider from '~/components/ui/UiScaleSlider.vue';

describe('UiScaleSlider', () => {
  describe('numeric mode (default)', () => {
    it('renders tick marks for each integer in range', async () => {
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: 14,
          min: 10,
          max: 20,
        },
      });

      expect(component.exists()).toBe(true);
      const ticks = component.findAll('[role="slider"] > div[class*="absolute flex flex-col"]');
      expect(ticks.length).toBe(11);
    });

    it('shows the current value in the thumb', async () => {
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: 15,
          min: 10,
          max: 20,
        },
      });

      expect(component.text()).toContain('15');
    });
  });

  describe('discrete mode (options)', () => {
    const options = [
      { label: 'Auto', value: 'auto' },
      { label: 'Low', value: 'low' },
      { label: 'Balanced', value: 'balanced' },
      { label: 'High', value: 'high' },
      { label: 'Custom', value: 'custom' },
    ];

    it('renders all option labels as ticks', async () => {
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: 'balanced',
          options,
        },
      });

      const text = component.text();
      expect(text).toContain('Auto');
      expect(text).toContain('Low');
      expect(text).toContain('Balanced');
      expect(text).toContain('High');
      expect(text).toContain('Custom');
    });

    it('shows the current option label in the thumb', async () => {
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: 'high',
          options,
        },
      });

      expect(component.text()).toContain('High');
    });

    it('emits update:modelValue when a tick is clicked', async () => {
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: 'auto',
          options,
        },
      });

      const track = component.find('[role="slider"]');
      await track.trigger('pointerdown', {
        button: 0,
        clientX: 500,
        pointerId: 1,
      });

      const emitted = component.emitted('update:modelValue');
      expect(emitted).toBeTruthy();
      expect(typeof emitted![0][0]).toBe('string');
    });

    it('falls back to first option when value is not found', async () => {
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: 'nonexistent',
          options,
        },
      });

      expect(component.text()).toContain('Auto');
    });
  });
});
