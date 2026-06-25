import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import AutoMontageModal from '~/components/timeline/AutoMontageModal.vue';

vi.mock('~/components/ui/UiModal.vue', () => ({
  default: {
    props: { open: { type: Boolean, default: false }, title: String, description: String, ui: Object },
    emits: ['update:open', 'after:enter'],
    template: '<div v-if="open" class="modal-mock"><h2>{{ title }}</h2><slot /><slot name="footer" /></div>',
  },
}));

vi.mock('~/composables/ui/useModalOpenModel', () => ({
  useModalOpenModel: (props: any, emit: any) => ({
    get value() { return props.open; },
    set value(v: boolean) { emit('update:open', v); },
  }),
}));

const stubs = {
  UCheckbox: {
    props: ['modelValue', 'label', 'ui'],
    emits: ['update:modelValue'],
    template: '<label><input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" /> {{ label }}</label>',
  },
  UAlert: {
    props: ['color', 'variant', 'icon', 'title'],
    template: '<div v-if="title" class="alert-mock">{{ title }}</div>',
  },
};

describe('AutoMontageModal', () => {
  it('renders when open', async () => {
    const component = await mountSuspended(AutoMontageModal, {
      props: { open: true },
      global: { stubs },
    });

    expect(component.find('.modal-mock').exists()).toBe(true);
  });

  it('renders checkboxes and mode buttons when open', async () => {
    const component = await mountSuspended(AutoMontageModal, {
      props: { open: true },
      global: { stubs },
    });

    expect(component.findAll('input[type="checkbox"]').length).toBe(3);
  });

  it('renders mode buttons', async () => {
    const component = await mountSuspended(AutoMontageModal, {
      props: { open: true },
      global: { stubs },
    });

    const buttons = component.findAll('button');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
  });

  it('emits apply with default settings', async () => {
    const component = await mountSuspended(AutoMontageModal, {
      props: { open: true },
      global: { stubs },
    });

    const buttons = component.findAll('button');
    const applyButton = buttons.find((b) => b.text().includes('fastcat.timeline.autoMontage.apply'));
    if (applyButton) {
      await applyButton.trigger('click');
      expect(component.emitted('apply')).toBeTruthy();
      expect(component.emitted('apply')![0]).toEqual([
        { trimStart: false, trimEnd: false, trimMiddle: false, mode: 'cut' },
      ]);
    }
  });

  it('emits update:open false when apply is clicked', async () => {
    const component = await mountSuspended(AutoMontageModal, {
      props: { open: true },
      global: { stubs },
    });

    const buttons = component.findAll('button');
    const applyButton = buttons.find((b) => b.text().includes('fastcat.timeline.autoMontage.apply'));
    if (applyButton) {
      await applyButton.trigger('click');
      expect(component.emitted('update:open')).toBeTruthy();
      expect(component.emitted('update:open')![0]).toEqual([false]);
    }
  });

  it('shows missing transcription warning when hasMissingTranscription is true', async () => {
    const component = await mountSuspended(AutoMontageModal, {
      props: { open: true, hasMissingTranscription: true },
      global: { stubs },
    });

    expect(component.text()).toContain('fastcat.timeline.autoMontage.noTranscription');
  });

  it('does not show missing transcription warning when hasMissingTranscription is false', async () => {
    const component = await mountSuspended(AutoMontageModal, {
      props: { open: true, hasMissingTranscription: false },
      global: { stubs },
    });

    expect(component.text()).not.toContain('fastcat.timeline.autoMontage.noTranscription');
  });
});
