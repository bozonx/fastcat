import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { mountWithNuxt } from '../../utils/mount';
import VideoEncodingForm from '~/components/media/VideoEncodingForm.vue';

import UiSelect from '~/components/ui/UiSelect.vue';

// Mock workspace store
vi.mock('~/stores/workspace.store', () => {
  return {
    useWorkspaceStore: () => ({
      userSettings: {
        exportPresets: {
          items: [
            {
              id: 'high',
              name: 'High Quality',
              format: 'mp4',
              videoCodec: 'avc1',
              bitrateMbps: 16,
              excludeAudio: false,
              audioCodec: 'aac',
              audioBitrateKbps: 320,
              bitrateMode: 'variable',
              keyframeIntervalSec: 2,
              exportAlpha: false,
              fastStart: true,
            },
            {
              id: 'social',
              name: 'Social Media',
              format: 'webm',
              videoCodec: 'vp09.00.10.08',
              bitrateMbps: 4,
              excludeAudio: false,
              audioCodec: 'opus',
              audioBitrateKbps: 128,
              bitrateMode: 'variable',
              keyframeIntervalSec: 2,
              exportAlpha: false,
              fastStart: true,
            },
          ],
          selectedPresetId: 'high',
        },
      },
    }),
  };
});

// Mock video codecs support composable
vi.mock('~/composables/useVideoCodecs', () => ({
  useVideoCodecs: vi.fn(() => ({
    videoCodecSupport: ref({}),
    isLoadingCodecSupport: ref(false),
    videoCodecOptions: ref([
      { value: 'avc1', label: 'H.264 / AVC' },
      { value: 'vp09.00.10.08', label: 'VP9' },
    ]),
    loadCodecSupport: vi.fn(),
  })),
}));

// Mock export codecs support composable
vi.mock('~/composables/timeline/export/core/useExportCodecs', () => ({
  useExportCodecs: vi.fn(() => ({
    audioCodecSupport: ref({
      aac: true,
      opus: true,
      mp3: true,
      flac: true,
      pcm: true,
    }),
    loadCodecSupport: vi.fn(),
  })),
}));

vi.mock('vue-i18n', () => ({
  useI18n: vi.fn(() => ({
    t: vi.fn((key: string) => key),
  })),
}));

// Test host component to emulate parent v-models
const TestHost = {
  components: { VideoEncodingForm },
  template: `
    <VideoEncodingForm
      v-model:output-format="outputFormat"
      v-model:video-codec="videoCodec"
      v-model:bitrate-mbps="bitrateMbps"
      v-model:exclude-audio="excludeAudio"
      v-model:audio-codec="audioCodec"
      v-model:audio-bitrate-kbps="audioBitrateKbps"
      v-model:preset="preset"
      :show-presets="true"
    />
  `,
  setup() {
    const outputFormat = ref('mp4');
    const videoCodec = ref('avc1');
    const bitrateMbps = ref(8);
    const excludeAudio = ref(false);
    const audioCodec = ref('aac');
    const audioBitrateKbps = ref(192);
    const preset = ref('custom');

    return {
      outputFormat,
      videoCodec,
      bitrateMbps,
      excludeAudio,
      audioCodec,
      audioBitrateKbps,
      preset,
    };
  },
};

describe('VideoEncodingForm.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders correctly and initializes presets list', async () => {
    const component = await mountWithNuxt(TestHost);
    expect(component.findComponent(UiSelect).exists()).toBe(true);
  });

  it('applies selected preset and keeps it selected (does not reset to custom)', async () => {
    const component = await mountWithNuxt(TestHost);

    // Emulate selecting 'high' preset by setting preset model value
    component.vm.preset = 'high';
    // Trigger applyPreset programmatically (since UiSelect uses defineModel + change callback under the hood)
    const formInstance = component.findComponent(VideoEncodingForm);
    await formInstance.vm.applyPreset('high');

    // Wait for watchers and nextTick to run
    await nextTick();
    await nextTick();

    // Verify all model values are updated correctly according to the 'high' preset
    expect(component.vm.outputFormat).toBe('mp4');
    expect(component.vm.videoCodec).toBe('avc1');
    expect(component.vm.bitrateMbps).toBe(16);
    expect(component.vm.audioCodec).toBe('aac');
    expect(component.vm.audioBitrateKbps).toBe(320);

    // Ensure preset has NOT reset back to 'custom'
    expect(component.vm.preset).toBe('high');
  });

  it('resets preset to custom when configuration is manually updated', async () => {
    const component = await mountWithNuxt(TestHost);

    // First select and apply 'high' preset
    component.vm.preset = 'high';
    const formInstance = component.findComponent(VideoEncodingForm);
    await formInstance.vm.applyPreset('high');
    await nextTick();
    await nextTick();

    expect(component.vm.preset).toBe('high');

    // Manually change bitrate (user input emulation)
    component.vm.bitrateMbps = 12;

    // Wait for deep watch in MediaEncodingSettings to trigger
    await nextTick();
    await nextTick();

    // Verify preset changes to custom
    expect(component.vm.preset).toBe('custom');
  });

  it('handles specifyMaxBitrate checkbox toggle correctly', async () => {
    const component = await mountWithNuxt(TestHostWithAdvanced);
    await nextTick();

    // Find the checkbox for specifying max bitrate
    const checkboxes = component.findAllComponents({ name: 'UCheckbox' });
    const specifyCheckbox = checkboxes.find(
      (c) => c.props('label') === 'videoEditor.export.specifyMaxBitrate',
    );
    expect(specifyCheckbox).toBeDefined();
    expect(specifyCheckbox!.props('modelValue')).toBe(false);

    // Turn specifyMaxBitrate ON
    await specifyCheckbox!.setValue(true);
    await nextTick();

    // Verify it calculates the default value (1.5 * bitrateMbps = 1.5 * 8 = 12)
    expect(component.vm.maxBitrateMbps).toBe(12);

    // Turn specifyMaxBitrate OFF
    await specifyCheckbox!.setValue(false);
    await nextTick();

    // Verify it resets to null
    expect(component.vm.maxBitrateMbps).toBeNull();
  });

  it('handles specifyMinBitrate checkbox toggle correctly', async () => {
    const component = await mountWithNuxt(TestHostWithAdvanced);
    await nextTick();

    // Find the checkbox for specifying min bitrate
    const checkboxes = component.findAllComponents({ name: 'UCheckbox' });
    const specifyCheckbox = checkboxes.find(
      (c) => c.props('label') === 'videoEditor.export.specifyMinBitrate',
    );
    expect(specifyCheckbox).toBeDefined();
    expect(specifyCheckbox!.props('modelValue')).toBe(false);

    // Turn specifyMinBitrate ON
    await specifyCheckbox!.setValue(true);
    await nextTick();

    // Verify it calculates the default value (0.5 * bitrateMbps = 0.5 * 8 = 4)
    expect(component.vm.minBitrateMbps).toBe(4);

    // Turn specifyMinBitrate OFF
    await specifyCheckbox!.setValue(false);
    await nextTick();

    // Verify it resets to null
    expect(component.vm.minBitrateMbps).toBeNull();
  });
});

// Test host component to emulate parent v-models with advanced settings
const TestHostWithAdvanced = {
  components: { VideoEncodingForm },
  template: `
    <VideoEncodingForm
      v-model:output-format="outputFormat"
      v-model:video-codec="videoCodec"
      v-model:bitrate-mbps="bitrateMbps"
      v-model:exclude-audio="excludeAudio"
      v-model:audio-codec="audioCodec"
      v-model:audio-bitrate-kbps="audioBitrateKbps"
      v-model:preset="preset"
      v-model:enable-advanced-settings="enableAdvancedSettings"
      v-model:max-bitrate-mbps="maxBitrateMbps"
      v-model:min-bitrate-mbps="minBitrateMbps"
      :show-presets="true"
    />
  `,
  setup() {
    const outputFormat = ref('mp4');
    const videoCodec = ref('avc1');
    const bitrateMbps = ref(8);
    const excludeAudio = ref(false);
    const audioCodec = ref('aac');
    const audioBitrateKbps = ref(192);
    const preset = ref('custom');
    const enableAdvancedSettings = ref(true);
    const maxBitrateMbps = ref<number | null>(null);
    const minBitrateMbps = ref<number | null>(null);

    return {
      outputFormat,
      videoCodec,
      bitrateMbps,
      excludeAudio,
      audioCodec,
      audioBitrateKbps,
      preset,
      enableAdvancedSettings,
      maxBitrateMbps,
      minBitrateMbps,
    };
  },
};
