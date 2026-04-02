import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import MobileMonitorAudioControl from '~/components/monitor/MobileMonitorAudioControl.vue';
import { useUiStore } from '~/stores/ui.store';

describe('MobileMonitorAudioControl', () => {
  let pinia: any;

  beforeEach(() => {
    pinia = createTestingPinia({
      createSpy: vi.fn,
      stubActions: false,
      initialState: {
        ui: {
          monitorVolume: 0.5,
          monitorMuted: false,
        },
      },
    });
  });

  const globalOptions = {
    plugins: [pinia],
    stubs: {
      UPopover: {
        template: '<div class="popover-stub"><slot /><slot name="content" /></div>',
      },
      USlider: {
        props: ['modelValue'],
        template: '<div class="slider-stub" @click="$emit(\'update:modelValue\', 0.8)"></div>',
      },
      UButton: {
        props: ['label', 'icon'],
        template: '<button class="button-stub" :class="icon">{{ label }}<slot /></button>',
      },
      UIcon: true,
    },
  };

  it('renders volume icon based on store state', async () => {
    const wrapper = mount(MobileMonitorAudioControl, {
      global: globalOptions,
    });

    const uiStore = useUiStore();

    // Initial 0.5 volume -> speaker-wave
    expect(wrapper.find('.i-heroicons-speaker-wave').exists()).toBe(true);

    // Muted -> speaker-x-mark
    uiStore.monitorMuted = true;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.i-heroicons-speaker-x-mark').exists()).toBe(true);

    // Unmuted, 0 volume -> speaker-x-mark
    uiStore.monitorMuted = false;
    uiStore.monitorVolume = 0;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.i-heroicons-speaker-x-mark').exists()).toBe(true);
  });

  it('updates volume when slider changes', async () => {
    const wrapper = mount(MobileMonitorAudioControl, {
      global: globalOptions,
    });

    const uiStore = useUiStore();
    const slider = wrapper.find('.slider-stub');

    await slider.trigger('click');
    expect(uiStore.monitorVolume).toBe(0.8);
  });

  it('unmutes when volume is increased from 0', async () => {
    const wrapper = mount(MobileMonitorAudioControl, {
      global: globalOptions,
    });

    const uiStore = useUiStore();
    uiStore.monitorMuted = true;
    uiStore.monitorVolume = 0;

    const slider = wrapper.find('.slider-stub');
    await slider.trigger('click'); // mocks update to 0.8

    expect(uiStore.monitorVolume).toBe(0.8);
    expect(uiStore.monitorMuted).toBe(false);
  });

  it('resets volume to 100% when reset button is clicked', async () => {
    const wrapper = mount(MobileMonitorAudioControl, {
      global: globalOptions,
    });

    const uiStore = useUiStore();
    uiStore.monitorVolume = 0.2;
    uiStore.monitorMuted = true;

    // Find the reset button (it has a label with percentage)
    const buttons = wrapper.findAll('.button-stub');
    const resetButton = buttons.find((b) => b.text().includes('%'));

    expect(resetButton?.exists()).toBe(true);
    await resetButton?.trigger('click');

    expect(uiStore.monitorVolume).toBe(1);
    expect(uiStore.monitorMuted).toBe(false);
  });
});
