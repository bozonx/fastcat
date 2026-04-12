import { defineComponent } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';

vi.mock('~/components/ui/UiSelect.vue', () => ({
  default: defineComponent({
    name: 'UiSelect',
    props: {
      items: { type: Array, default: () => [] },
      searchable: { type: Boolean, default: undefined },
    },
    template:
      '<div class="ui-select-mock" :data-searchable="String(searchable)">{{ JSON.stringify(items) }}</div>',
  }),
}));

import FileConversionAudioSettings from '~/components/file-manager/FileConversionAudioSettings.vue';

describe('FileConversionAudioSettings', () => {
  it('disables search and shows original sample rate option in kHz', async () => {
    const wrapper = await mountSuspended(FileConversionAudioSettings, {
      props: {
        audioBitrateKbps: 128,
        audioChannels: 2,
        audioSampleRate: 0,
        originalSampleRate: 44100,
        originalChannels: 2,
        allowOriginalSampleRate: true,
      },
      global: {
        stubs: {
          UiButtonGroup: true,
          UiWheelNumberInput: true,
          USwitch: true,
        },
      },
    });

    const select = wrapper.get('.ui-select-mock');
    const items = JSON.parse(select.text());

    expect(select.attributes('data-searchable')).toBe('false');
    expect(items[0]).toEqual({
      value: 0,
      label: 'videoEditor.audio.original (44.1 kHz)',
    });
  });
});
