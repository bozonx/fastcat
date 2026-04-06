import { describe, it, expect, vi } from 'vitest';
import { nextTick } from 'vue';
import { mountWithNuxt } from '../../utils/mount';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';

vi.mock('~/components/ui/UiWheelNumberInput.vue', () => ({
  default: {
    name: 'UiWheelNumberInput',
    template: '<div class="mock-wheel-number-input">{{ modelValue }}</div>',
    props: ['modelValue'],
  },
}));

vi.mock('~/components/ui/UiSelect.vue', () => ({
  default: {
    name: 'UiSelect',
    template: '<div class="mock-ui-select">{{ JSON.stringify(items) }}</div>',
    props: ['items', 'modelValue'],
  },
}));

vi.mock('~/components/ui/UiButtonGroup.vue', () => ({
  default: {
    name: 'UiButtonGroup',
    template: '<div class="mock-button-group">{{ JSON.stringify(options) }}</div>',
    props: ['options', 'modelValue'],
  },
}));

describe('ParamsRenderer', () => {
  it('updates scale-xy presentation when linked state changes', async () => {
    const component = await mountWithNuxt(ParamsRenderer, {
      props: {
        controls: [
          {
            kind: 'scale-xy',
            keyX: 'scaleX',
            keyY: 'scaleY',
            keyLinked: 'linked',
          },
        ],
        values: {
          linked: true,
          scaleX: 120,
          scaleY: 140,
        },
      },
    });

    expect(component.text()).toContain('Scale');
    expect(component.text()).not.toContain('Scale Y');
    expect(component.findAll('.mock-wheel-number-input')).toHaveLength(1);

    await component.setProps({
      values: {
        linked: false,
        scaleX: 120,
        scaleY: 140,
      },
    });
    await nextTick();

    expect(component.text()).toContain('Scale X');
    expect(component.text()).toContain('Scale Y');
    expect(component.findAll('.mock-wheel-number-input')).toHaveLength(2);
  });

  it('renders translated option lists for select and button-group controls', async () => {
    const component = await mountWithNuxt(ParamsRenderer, {
      props: {
        controls: [
          {
            kind: 'select',
            key: 'quality',
            label: 'Quality',
            options: [
              { value: 'high', label: 'High' },
              { value: 'low', label: 'Low' },
            ],
          },
          {
            kind: 'button-group',
            key: 'mode',
            label: 'Mode',
            options: [
              { value: 'fit', label: 'Fit' },
              { value: 'fill', label: 'Fill' },
            ],
          },
        ],
        values: {
          quality: 'high',
          mode: 'fit',
        },
      },
    });

    expect(component.find('.mock-ui-select').text()).toContain('High');
    expect(component.find('.mock-ui-select').text()).toContain('Low');
    expect(component.find('.mock-button-group').text()).toContain('Fit');
    expect(component.find('.mock-button-group').text()).toContain('Fill');
  });

  it('updates array empty state and rendered cards from cached array items', async () => {
    const component = await mountWithNuxt(ParamsRenderer, {
      props: {
        controls: [
          {
            kind: 'array',
            key: 'points',
            itemTemplate: [],
            defaultItem: { x: 0 },
          },
        ],
        values: {
          points: [],
        },
      },
    });

    expect(component.text()).toContain('Empty');

    await component.setProps({
      values: {
        points: [{ x: 10 }, { x: 20 }],
      },
    });
    await nextTick();

    expect(component.text()).not.toContain('Empty');
    expect(component.text()).toContain('#1');
    expect(component.text()).toContain('#2');
  });
});
