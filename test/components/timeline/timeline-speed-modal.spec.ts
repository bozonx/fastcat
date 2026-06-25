import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import TimelineSpeedModal from '~/components/timeline/TimelineSpeedModal.vue';

vi.mock('~/components/ui/UiModal.vue', () => ({
  default: {
    props: {
      open: { type: Boolean, default: false },
      title: String,
      description: String,
      ui: Object,
    },
    emits: ['update:open', 'after:enter'],
    template:
      '<div v-if="open" class="modal-mock"><h2>{{ title }}</h2><p v-if="description">{{ description }}</p><slot /><slot name="footer" /></div>',
  },
}));

vi.mock('~/components/ui/UiSliderInput.vue', () => ({
  default: {
    props: ['modelValue', 'label', 'min', 'max', 'step', 'unit', 'showInput', 'defaultValue'],
    emits: ['update:modelValue'],
    template:
      '<input type="range" :value="modelValue" :min="min" :max="max" :step="step" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
}));

vi.mock('~/composables/ui/useModalOpenModel', () => ({
  useModalOpenModel: (props: any, emit: any) => ({
    get value() {
      return props.open;
    },
    set value(v: boolean) {
      emit('update:open', v);
    },
  }),
}));

describe('TimelineSpeedModal', () => {
  it('renders when open', async () => {
    const component = await mountSuspended(TimelineSpeedModal, {
      props: { open: true, speed: 1, hasAudio: false },
    });

    expect(component.exists()).toBe(true);
    expect(component.find('.modal-mock').exists()).toBe(true);
  });

  it('emits update:speed when slider changes', async () => {
    const component = await mountSuspended(TimelineSpeedModal, {
      props: { open: true, speed: 1, hasAudio: false },
    });

    await component.find('input[type="range"]').setValue(2);

    expect(component.emitted('update:speed')).toBeTruthy();
    expect(component.emitted('update:speed')![0]).toEqual([2]);
  });

  it('emits save when save button is clicked', async () => {
    const component = await mountSuspended(TimelineSpeedModal, {
      props: { open: true, speed: 1, hasAudio: false },
    });

    const buttons = component.findAll('button');
    const saveButton = buttons.find((b) => b.text().includes('common.save'));
    if (saveButton) {
      await saveButton.trigger('click');
      expect(component.emitted('save')).toBeTruthy();
    }
  });

  it('shows negative speed audio warning when speed < 0 and hasAudio', async () => {
    const component = await mountSuspended(TimelineSpeedModal, {
      props: { open: true, speed: -1, hasAudio: true },
    });

    expect(component.text()).toContain('fastcat.timeline.negativeSpeedAudioUnsupportedTitle');
  });

  it('does not show negative speed audio warning when hasAudio is false', async () => {
    const component = await mountSuspended(TimelineSpeedModal, {
      props: { open: true, speed: -1, hasAudio: false },
    });

    expect(component.text()).not.toContain('fastcat.timeline.negativeSpeedAudioUnsupportedTitle');
  });

  it('shows low speed warning when speed is between 0 and 0.1', async () => {
    const component = await mountSuspended(TimelineSpeedModal, {
      props: { open: true, speed: 0.05, hasAudio: false },
    });

    expect(component.text()).toContain('fastcat.timeline.speedTooLowTitle');
  });

  it('does not show low speed warning when speed is 0', async () => {
    const component = await mountSuspended(TimelineSpeedModal, {
      props: { open: true, speed: 0, hasAudio: false },
    });

    expect(component.text()).not.toContain('fastcat.timeline.speedTooLowTitle');
  });
});
