import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive, ref } from 'vue';
import FileConversionModal from '~/components/file-manager/FileConversionModal.vue';

// Each field must be a ref because storeToRefs() unpacks store state into refs.
const isModalOpen = ref(true);
const isConverting = ref(false);
const isExtractingMetadata = ref(false);
const targetEntry = ref<any>({ name: 'clip.mp4' });
const mediaType = ref('video');
const sourceHasAudio = ref(true);
const video = reactive({
  format: 'mp4',
  videoCodec: 'h264',
  bitrateMbps: 5,
  excludeAudio: false,
  audioCodec: 'aac',
  audioBitrateKbps: 128,
  bitrateMode: 'vbr',
  keyframeIntervalSec: 2,
  fastStart: true,
  width: 1920,
  height: 1080,
  fps: 30,
  resolutionFormat: '1080p',
  orientation: 'landscape',
  aspectRatio: '16:9',
  isCustomResolution: false,
});
const audio = reactive({
  onlyFormat: 'mp3',
  onlyBitrateKbps: 192,
  channels: 2,
  sampleRate: 48000,
  originalSampleRate: 48000,
  originalChannels: 2,
  reverse: false,
});
const image = reactive({
  quality: 90,
  width: 800,
  height: 600,
  isResolutionLinked: true,
  aspectRatio: 800 / 600,
});
const conversionError = ref('');
const conversionWarnings = ref<string[]>([]);

const startConversionMock = vi.fn();

vi.mock('~/stores/file-conversion.store', () => ({
  useFileConversionStore: () => ({
    isModalOpen,
    isConverting,
    isExtractingMetadata,
    targetEntry,
    mediaType,
    sourceHasAudio,
    video,
    audio,
    image,
    conversionError,
    conversionWarnings,
  }),
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({}),
}));

vi.mock('~/composables/file-conversion/useFileConversionStoreActions', () => ({
  useFileConversionStoreActions: () => ({ startConversion: startConversionMock }),
}));

vi.mock('~/utils/conversion/helpers', () => ({
  resolveAudioOnlyFileExtension: (format: string) => format,
}));

vi.mock('~/composables/timeline/export/core/useAudioCodecOptions', () => ({
  useAudioCodecOptions: () => ({ audioCodecOptions: [{ value: 'mp3', label: 'MP3' }] }),
}));

// Stub heavy child components.
const childStubs = {
  UiModal: {
    props: ['open', 'title', 'ui'],
    emits: ['update:open'],
    template:
      '<div v-if="open" class="ui-modal-mock"><h2>{{ title }}</h2><slot /><slot name="footer" /></div>',
  },
  MediaResolutionSettings: { template: '<div class="resolution-stub" />' },
  VideoEncodingForm: { template: '<div class="video-encoding-stub" />' },
  FileConversionAudioSettings: { template: '<div class="audio-settings-stub" />' },
  UiWheelNumberInput: {
    props: ['modelValue', 'min', 'step'],
    emits: ['update:modelValue'],
    template:
      '<input type="number" class="wheel-number-stub" :value="modelValue" :min="min" @input="$emit(\'update:modelValue\', Number($event.target.value))" />',
  },
  UiSliderInput: {
    props: ['modelValue', 'min', 'max', 'step', 'decimals', 'unit', 'label'],
    emits: ['update:modelValue'],
    template: '<input type="range" class="slider-stub" :value="modelValue" />',
  },
  UiButtonGroup: {
    props: ['modelValue', 'options'],
    emits: ['update:modelValue'],
    template: '<div class="btn-group-stub" />',
  },
  UButton: {
    props: ['color', 'variant', 'icon', 'size', 'disabled', 'loading'],
    emits: ['click'],
    template:
      '<button class="u-button" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  },
  UIcon: { props: ['name'], template: '<span class="icon-mock" />' },
};

function resetState() {
  isModalOpen.value = true;
  isConverting.value = false;
  isExtractingMetadata.value = false;
  targetEntry.value = { name: 'clip.mp4' };
  mediaType.value = 'video';
  sourceHasAudio.value = true;
  video.bitrateMbps = 5;
  video.width = 1920;
  video.height = 1080;
  video.fps = 30;
  video.keyframeIntervalSec = 2;
  video.excludeAudio = false;
  video.audioBitrateKbps = 128;
  video.format = 'mp4';
  audio.onlyBitrateKbps = 192;
  audio.onlyFormat = 'mp3';
  image.width = 800;
  image.height = 600;
  image.isResolutionLinked = true;
  image.aspectRatio = 800 / 600;
  conversionError.value = '';
  conversionWarnings.value = [];
  startConversionMock.mockClear();
}

describe('FileConversionModal', () => {
  it('renders modal with output file name for video', async () => {
    resetState();
    const component = await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    expect(component.find('.ui-modal-mock').exists()).toBe(true);
    expect(component.text()).toContain('clip_converted.mp4');
  });

  it('shows convert-to-webp title for image mediaType', async () => {
    resetState();
    mediaType.value = 'image';
    const component = await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    expect(component.find('h2').text()).toBe('videoEditor.fileManager.convert.convertToWebp');
  });

  it('shows generic convert title for video mediaType', async () => {
    resetState();
    mediaType.value = 'video';
    const component = await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    expect(component.find('h2').text()).toBe('videoEditor.export.convertFile');
  });

  it('computes output file name with audio extension', async () => {
    resetState();
    mediaType.value = 'audio';
    audio.onlyFormat = 'wav';
    targetEntry.value = { name: 'song.flac' };
    const component = await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    expect(component.text()).toContain('song_converted.wav');
  });

  it('computes output file name with webp for image', async () => {
    resetState();
    mediaType.value = 'image';
    targetEntry.value = { name: 'pic.png' };
    const component = await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    expect(component.text()).toContain('pic_converted.webp');
  });

  it('disables convert button when form invalid (bitrate 0)', async () => {
    resetState();
    video.bitrateMbps = 0;
    const component = await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    const buttons = component.findAll('button.u-button');
    const convertBtn = buttons[buttons.length - 1]!;
    expect(convertBtn.attributes('disabled')).toBeDefined();
  });

  it('enables convert button when form valid', async () => {
    resetState();
    const component = await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    const buttons = component.findAll('button.u-button');
    const convertBtn = buttons[buttons.length - 1]!;
    expect(convertBtn.attributes('disabled')).toBeUndefined();
  });

  it('auto-sets excludeAudio when video source has no audio', async () => {
    resetState();
    sourceHasAudio.value = false;
    video.excludeAudio = false;
    await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    expect(video.excludeAudio).toBe(true);
  });

  it('does not force excludeAudio when source has audio', async () => {
    resetState();
    sourceHasAudio.value = true;
    video.excludeAudio = false;
    await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    expect(video.excludeAudio).toBe(false);
  });

  it('links image height to width when resolution linked and width changes', async () => {
    resetState();
    mediaType.value = 'image';
    image.aspectRatio = 2; // 2:1
    image.isResolutionLinked = true;
    const component = await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    const widthInputs = component.findAll('.wheel-number-stub');
    await widthInputs[0]!.setValue(400);

    expect(image.width).toBe(400);
    expect(image.height).toBe(200); // 400 / 2
  });

  it('links image width to height when resolution linked and height changes', async () => {
    resetState();
    mediaType.value = 'image';
    image.aspectRatio = 2;
    image.isResolutionLinked = true;
    const component = await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    const inputs = component.findAll('.wheel-number-stub');
    await inputs[1]!.setValue(100);

    expect(image.height).toBe(100);
    expect(image.width).toBe(200); // 100 * 2
  });

  it('starts conversion when convert button clicked', async () => {
    resetState();
    const component = await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    const buttons = component.findAll('button.u-button');
    const convertBtn = buttons[buttons.length - 1]!;
    await convertBtn.trigger('click');

    expect(startConversionMock).toHaveBeenCalled();
  });

  it('closes modal when cancel clicked', async () => {
    resetState();
    const component = await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    const cancelBtn = component.findAll('button.u-button')[0]!;
    await cancelBtn.trigger('click');

    expect(isModalOpen.value).toBe(false);
  });

  it('renders conversion error when present', async () => {
    resetState();
    conversionError.value = 'Something went wrong';
    const component = await mountSuspended(FileConversionModal, { global: { stubs: childStubs } });

    expect(component.text()).toContain('Something went wrong');
  });
});
