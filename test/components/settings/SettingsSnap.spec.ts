import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import SettingsSnap from '~/components/settings/SettingsSnap.vue';

const SnapSettingsPanelStub = {
  template: '<div class="snap-settings-panel-stub" />',
};

describe('SettingsSnap', () => {
  it('renders SnapSettingsPanel', async () => {
    const component = await mountSuspended(SettingsSnap, {
      global: { stubs: { SnapSettingsPanel: SnapSettingsPanelStub } },
    });

    expect(component.find('.snap-settings-panel-stub').exists()).toBe(true);
  });
});
