import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({
    t: vi.fn((key: string) => key),
  })),
}));

// Test host component to emulate parent v-models
const TestHost = {
  components: { MediaResolutionSettings },
  template: `
    <MediaResolutionSettings
      v-model:width="width"
      v-model:height="height"
      v-model:fps="fps"
      v-model:resolution-format="resolutionFormat"
      v-model:orientation="orientation"
      v-model:aspect-ratio="aspectRatio"
      v-model:is-custom-resolution="isCustomResolution"
      v-model:sample-rate="sampleRate"
      :disabled="disabled"
      :standard-fps-only="standardFpsOnly"
    />
  `,
  setup() {
    const width = ref(1920);
    const height = ref(1080);
    const fps = ref(30);
    const resolutionFormat = ref('1080p');
    const orientation = ref<'landscape' | 'portrait'>('landscape');
    const aspectRatio = ref('16:9');
    const isCustomResolution = ref(false);
    const sampleRate = ref(48000);
    const disabled = ref(false);
    const standardFpsOnly = ref(false);

    return {
      width,
      height,
      fps,
      resolutionFormat,
      orientation,
      aspectRatio,
      isCustomResolution,
      sampleRate,
      disabled,
      standardFpsOnly,
    };
  },
};

describe('MediaResolutionSettings', () => {
  it('renders correctly and propagates disabled class to custom resolution switch and form field', async () => {
    const wrapper = await mountSuspended(TestHost);

    // Check initially not disabled (no cursor-not-allowed)
    const formField = wrapper.findComponent({ name: 'UiFormField' });
    const switchComponent = wrapper.findComponent({ name: 'USwitch' });
    expect(formField.classes()).not.toContain('cursor-not-allowed');
    expect(switchComponent.classes()).not.toContain('cursor-not-allowed');

    // Set disabled to true
    (wrapper.vm as any).disabled = true;
    await wrapper.vm.$nextTick();

    expect(formField.classes()).toContain('cursor-not-allowed');
    expect(switchComponent.classes()).toContain('cursor-not-allowed');
  });

  it('uses a fixed standard fps select when requested by the timeline', async () => {
    const wrapper = await mountSuspended(TestHost);
    (wrapper.vm as any).standardFpsOnly = true;
    await wrapper.vm.$nextTick();

    const fpsSelect = wrapper
      .findAllComponents({ name: 'UiSelect' })
      .find((select) =>
        select.props('items')?.some((item: { label?: string }) => item.label === '29.97'),
      );

    expect(fpsSelect).toBeDefined();
    expect(fpsSelect?.props('items')).toHaveLength(15);
    expect(
      fpsSelect?.props('items').find((item: { label: string }) => item.label === '29.97'),
    ).toEqual({
      label: '29.97',
      value: 29.97,
    });
  });
});
