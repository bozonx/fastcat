import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import type { TimelineShapeClipItem } from '~/timeline/types';
import ClipShapeProperties from '~/components/properties/clip/ClipShapeProperties.vue';

function createClip(overrides: Partial<TimelineShapeClipItem> = {}): TimelineShapeClipItem {
  return {
    kind: 'clip',
    clipType: 'shape',
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Shape Clip',
    timelineRange: { startUs: 0, durationUs: 5_000_000 },
    sourceRange: { startUs: 0, durationUs: 5_000_000 },
    shapeType: 'square',
    snapToPixelGrid: true,
    ...overrides,
  } as TimelineShapeClipItem;
}

function stubs() {
  return {
    PropertySection: {
      template: '<div class="prop-section"><slot /></div>',
      props: ['title', 'enabled'],
      emits: ['update:enabled'],
    },
    PropertyField: {
      template: '<div class="prop-field" :data-label="label"><slot /></div>',
      props: ['label'],
    },
    UiWheelNumberInput: {
      template: '<input class="ui-number" :value="modelValue" />',
      props: ['modelValue'],
      emits: ['update:modelValue'],
    },
    UiSelect: {
      template:
        '<select class="ui-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item[valueKey || \'value\'] ?? item" :value="item[valueKey || \'value\'] ?? item">{{ item[labelKey || \'label\'] ?? item }}</option></select>',
      props: ['modelValue', 'items', 'valueKey', 'labelKey'],
      emits: ['update:modelValue'],
    },
    UColorPicker: {
      template: '<div class="u-color-picker"></div>',
      props: ['modelValue'],
      emits: ['update:modelValue'],
    },
    UButton: {
      template: '<button class="u-button"><slot /></button>',
      props: ['icon'],
      emits: ['click'],
    },
    USwitch: {
      template:
        '<button class="u-switch" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
      props: ['modelValue'],
      emits: ['update:modelValue'],
    },
    UTooltip: {
      template: '<span class="u-tooltip"><slot /></span>',
      props: ['text'],
    },
    UIcon: {
      template: '<span class="u-icon" :class="name"></span>',
      props: ['name'],
    },
  };
}

async function mountComponent(clip: TimelineShapeClipItem = createClip()) {
  return mountSuspended(ClipShapeProperties, {
    props: {
      clip,
      presets: [],
      hidePresets: true,
    },
    global: { stubs: stubs() },
  });
}

describe('ClipShapeProperties.vue', () => {
  it('renders the snap-to-pixel-grid switch', async () => {
    const wrapper = await mountComponent();
    const switches = wrapper.findAll('.u-switch');
    expect(switches.length).toBe(1);
  });

  it('emits updateSnapToPixelGrid when the snap toggle is clicked', async () => {
    const wrapper = await mountComponent();
    const snapSwitch = wrapper.find('.u-switch');
    expect(snapSwitch.exists()).toBe(true);
    await snapSwitch.trigger('click');

    expect(wrapper.emitted('updateSnapToPixelGrid')).toBeTruthy();
    expect(wrapper.emitted('updateSnapToPixelGrid')?.at(-1)?.[0]).toBe(false);
  });
});
