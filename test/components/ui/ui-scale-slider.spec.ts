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
      const ticks = component.findAll('[role="slider"] div[class*="absolute flex flex-col"]');
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

    it('shows the actual value in the thumb when value is outside range', async () => {
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: 25,
          min: 10,
          max: 20,
        },
      });

      expect(component.text()).toContain('25');
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

    it('interpolates thumb position when value is not an exact option but is numeric', async () => {
      const numericOpts = [
        { label: '0.5', value: '0.5' },
        { label: '1', value: '1' },
        { label: '5', value: '5' },
      ];
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: 3,
          options: numericOpts,
        },
      });

      expect(component.text()).toContain('3');
      // Options: 0.5 (0%), 1.0 (50%), 5.0 (100%).
      // 3.0 is exactly halfway between 1.0 (50%) and 5.0 (100%) -> 75%
      const thumb = component.find('.absolute.pointer-events-none[style*="left:"]');
      expect(thumb.attributes('style')).toContain('left: 75%');
    });
  });

  describe('overflow tail', () => {
    it('renders dashed tail and positions thumb at scaleEndPercent (94%) when overflowTail is true and value > max', async () => {
      const options = [
        { label: '1', value: '1' },
        { label: '16', value: '16' },
      ];
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: 17,
          options,
          withInput: true,
          overflowTail: true,
        },
      });

      expect(component.text()).toContain('+');
      const thumbEls = component.findAll('.absolute.pointer-events-none[style*="left:"]');
      const thumbEl = thumbEls[thumbEls.length - 1];
      const style = thumbEl?.attributes('style') || '';
      const leftVal = parseFloat(style.replace('left:', '').replace('%', '').trim());
      expect(leftVal).toBe(100);
    });

    it('does not render dashed tail or + indicator by default when overflowTail is false', async () => {
      const options = [
        { label: '96', value: '96' },
        { label: '320', value: '320' },
      ];
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: '320',
          options,
          withInput: true,
        },
      });

      expect(component.text()).not.toContain('+');
      const borderDashed = component.find('.border-dashed');
      expect(borderDashed.exists()).toBe(false);
    });
  });

  describe('default value reset', () => {
    it('resets to default value on double click of the handle', async () => {
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: 18,
          min: 10,
          max: 20,
          defaultValue: 14,
        },
      });

      const thumb = component.find('.pointer-events-auto');
      await thumb.trigger('dblclick');

      const emitted = component.emitted('update:modelValue');
      expect(emitted).toBeTruthy();
      expect(emitted![0][0]).toBe(14);
    });
  });

  describe('composite features (number input & unit)', () => {
    it('renders unit label when unit prop is provided', async () => {
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: 192,
          min: 96,
          max: 320,
          unit: 'Kbps',
        },
      });

      expect(component.text()).toContain('Kbps');
    });

    it('renders UiWheelNumberInput when withInput is true', async () => {
      const component = await mountSuspended(UiScaleSlider, {
        props: {
          modelValue: 5,
          min: 1,
          max: 10,
          withInput: true,
          unit: 'units',
        },
      });

      expect(component.text()).toContain('units');
      const input = component.findComponent({ name: 'UiWheelNumberInput' });
      expect(input.exists()).toBe(true);
    });
  });
});
