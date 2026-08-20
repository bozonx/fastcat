import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountWithNuxt } from '../../utils/mount';
import ExportForm from '~/components/export/ExportForm.vue';

/**
 * Component-level coverage for ExportForm.vue: the presentational/interaction
 * layer that useExportForm.test.ts (which drives the composable directly) never
 * exercises — range-option selection, the dirty/reset control, and the
 * exporting-state footer (progress + cancel + disabled start).
 *
 * The composable is mocked so the test controls form state precisely and asserts
 * how the template renders and wires clicks back to the composable.
 */

// A mutable reactive state object shared with the tests via globalThis. Built
// inside an async factory so `ref` is available despite vi.mock hoisting.
vi.mock('~/composables/timeline/export/useExportForm', async () => {
  const { ref } = await import('vue');
  const state = {
    isExporting: ref(false),
    exportProgress: ref(0),
    exportError: ref<string | null>(null),
    exportWarnings: ref<string[]>([]),
    exportDurationMs: ref<number | null>(null),
    lastExportStatus: ref<'idle' | 'success' | 'error'>('idle'),
    cancelRequested: ref(false),
    outputFilename: ref('my-video'),
    filenameError: ref<string | null>(null),
    outputFormat: ref('mp4'),
    videoCodec: ref('avc1.640032'),
    bitrateMbps: ref(8),
    excludeAudio: ref(false),
    audioCodec: ref('aac'),
    audioBitrateKbps: ref(192),
    audioChannels: ref('stereo'),
    audioSampleRate: ref(48000),
    exportWidth: ref(1920),
    exportHeight: ref(1080),
    exportFps: ref(30),
    resolutionFormat: ref('landscape'),
    orientation: ref('landscape'),
    aspectRatio: ref('16:9'),
    isCustomResolution: ref(false),
    bitrateMode: ref('variable'),
    keyframeIntervalSec: ref(2),
    exportAlpha: ref(false),
    fastStart: ref(true),
    includeMetadata: ref(false),
    metadataTitle: ref(''),
    metadataDescription: ref(''),
    metadataAuthor: ref(''),
    metadataTags: ref(''),
    selectedExportRangeId: ref('timeline'),
    exportRangeOptions: ref([
      { id: 'timeline', label: 'Whole timeline', description: 'Everything' },
      {
        id: 'selection',
        label: 'Selection',
        description: 'Selected range',
        range: { startTicks: 1_000_000, endTicks: 3_000_000 },
      },
      {
        id: 'marker:1',
        label: 'Chapter 1',
        description: 'Marker zone',
        color: '#4a90e2',
        range: { startTicks: 4_000_000, endTicks: 6_000_000 },
      },
    ]),
    hasSelectableExportRanges: ref(true),
    isSettingsDirty: ref(false),
    matchTimeline: ref(true),
    customExportPath: ref<string | null>(null),
    isTauri: ref(false),
    exportType: ref<'video' | 'audio'>('video'),
    ext: ref('mp4'),

    initializeExportForm: vi.fn().mockResolvedValue(undefined),
    pickTauriExportPath: vi.fn(),
    handleOutputFormatChange: vi.fn(),
    handleStartExport: vi.fn().mockResolvedValue(undefined),
    getPhaseLabel: vi.fn().mockReturnValue('Rendering'),
    validateFilename: vi.fn().mockResolvedValue(undefined),
    cancelExport: vi.fn(),
    resetAllSettings: vi.fn(),
    resetField: vi.fn(),
    isFieldDirty: vi.fn().mockReturnValue(false),
  };
  (globalThis as Record<string, unknown>).__exportFormMock = state;
  return { useExportForm: () => state };
});

// Stub the heavy media sub-forms — they have their own store deps and their own
// coverage; ExportForm only needs to render its wrapper around them.
vi.mock('~/components/media/VideoEncodingForm.vue', () => ({
  default: { name: 'VideoEncodingForm', template: '<div data-stub="video-encoding" />' },
}));
vi.mock('~/components/media/MediaResolutionSettings.vue', () => ({
  default: { name: 'MediaResolutionSettings', template: '<div data-stub="resolution" />' },
}));
vi.mock('~/components/file-manager/FileConversionAudioSettings.vue', () => ({
  default: { name: 'FileConversionAudioSettings', template: '<div data-stub="audio-settings" />' },
}));

const mockNotifyFileManagerUpdate = vi.fn();
const mockReloadDirectory = vi.fn().mockResolvedValue(undefined);

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => ({ currentView: 'export' }),
}));
vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => ({ duration: 5_000_000 }),
}));
vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => ({ notifyFileManagerUpdate: mockNotifyFileManagerUpdate }),
}));
vi.mock('~/stores/focus.store', () => ({
  useFocusStore: () => ({ isPanelFocused: () => false, setPanelFocus: vi.fn() }),
}));
vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: () => ({ reloadDirectory: mockReloadDirectory }),
}));

interface ExportFormMock {
  isExporting: { value: boolean };
  isSettingsDirty: { value: boolean };
  selectedExportRangeId: { value: string };
  resetAllSettings: ReturnType<typeof vi.fn>;
  cancelExport: ReturnType<typeof vi.fn>;
}

function formMock(): ExportFormMock {
  return (globalThis as Record<string, unknown>).__exportFormMock as ExportFormMock;
}

describe('ExportForm.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const m = formMock();
    m.isExporting.value = false;
    m.isSettingsDirty.value = false;
    m.selectedExportRangeId.value = 'timeline';
  });

  it('renders one button per selectable export range', async () => {
    const wrapper = await mountWithNuxt(ExportForm);
    const rangeButtons = wrapper.findAll('button').filter((b) => {
      const txt = b.text();
      return (
        txt.includes('Whole timeline') || txt.includes('Selection') || txt.includes('Chapter 1')
      );
    });
    expect(rangeButtons).toHaveLength(3);
  });

  it('selecting a range updates the bound selectedExportRangeId', async () => {
    const wrapper = await mountWithNuxt(ExportForm);
    const m = formMock();
    expect(m.selectedExportRangeId.value).toBe('timeline');

    const selectionButton = wrapper.findAll('button').find((b) => b.text().includes('Selection'))!;
    await selectionButton.trigger('click');

    expect(m.selectedExportRangeId.value).toBe('selection');
  });

  it('shows the reset control only when settings are dirty and wires it to resetAllSettings', async () => {
    const wrapper = await mountWithNuxt(ExportForm);
    expect(wrapper.find('[data-testid="export-reset"]').exists()).toBe(false);

    formMock().isSettingsDirty.value = true;
    await wrapper.vm.$nextTick();

    const reset = wrapper.find('[data-testid="export-reset"]');
    expect(reset.exists()).toBe(true);
    await reset.trigger('click');
    expect(formMock().resetAllSettings).toHaveBeenCalledTimes(1);
  });

  it('while exporting shows progress + cancel and disables start', async () => {
    const wrapper = await mountWithNuxt(ExportForm);
    // Idle: no progress, no cancel, start enabled.
    expect(wrapper.find('[data-testid="export-progress"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="export-cancel"]').exists()).toBe(false);

    formMock().isExporting.value = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="export-progress"]').exists()).toBe(true);
    const cancel = wrapper.find('[data-testid="export-cancel"]');
    expect(cancel.exists()).toBe(true);

    const start = wrapper.find('[data-testid="export-start"]');
    expect(start.attributes('disabled')).toBeDefined();

    await cancel.trigger('click');
    expect(formMock().cancelExport).toHaveBeenCalledTimes(1);
  });
});
