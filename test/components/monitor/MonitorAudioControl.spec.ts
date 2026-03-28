import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createTestingPinia } from '@pinia/testing';
import MonitorAudioControl from '~/components/monitor/MonitorAudioControl.vue';
import { useUiStore } from '~/stores/ui.store';
import UiVolumeControl from '~/components/ui/editor/UiVolumeControl.vue';

describe('MonitorAudioControl', () => {
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

  it('renders UiVolumeControl with correct props from uiStore', () => {
    const wrapper = mount(MonitorAudioControl, {
      global: {
        plugins: [pinia],
        stubs: {
          UiVolumeControl: true,
          UTooltip: true,
        },
      },
    });

    const volumeControl = wrapper.findComponent({ name: 'UiVolumeControl' });
    expect(volumeControl.exists()).toBe(true);
    // Note: in actual implementation it might find by component name or reference
    // Since we stubbed it, we can check props if it's not a functional stub or just check the presence.
  });

  it('binds volume and mute state to uiStore', async () => {
    // We don't stub UiVolumeControl here to see if it actually emits/updates
    const wrapper = mount(MonitorAudioControl, {
      global: {
        plugins: [pinia],
        stubs: {
          UTooltip: { template: '<div><slot /></div>' },
          UIcon: true,
        },
      },
    });

    const uiStore = useUiStore();
    const volumeControl = wrapper.getComponent(UiVolumeControl);

    // Initial state
    expect(volumeControl.props('volume')).toBe(0.5);
    expect(volumeControl.props('isMuted')).toBe(false);

    // Update from store
    uiStore.monitorVolume = 0.8;
    await wrapper.vm.$nextTick();
    expect(volumeControl.props('volume')).toBe(0.8);

    // Update from component (mocking emit)
    await volumeControl.vm.$emit('update:volume', 1.2);
    expect(uiStore.monitorVolume).toBe(1.2);

    await volumeControl.vm.$emit('update:isMuted', true);
    expect(uiStore.monitorMuted).toBe(true);
  });
});
