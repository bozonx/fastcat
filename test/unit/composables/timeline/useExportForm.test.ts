/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { useExportForm } from '~/composables/timeline/export/useExportForm';

const selectionRangeMock = ref<{ startUs: number; endUs: number } | null>(null);
const markersMock = ref<
  Array<{ id: string; timeUs: number; durationUs?: number; text: string; color?: string }>
>([]);
const selectedEntityMock = ref<any>(null);

const exportTimelineToFileMock = vi.fn();
const validateFilenameMock = vi.fn(async () => true);
const getNextAvailableFilenameMock = vi.fn(async () => 'timeline.mp4');
const existingFilesMock = new Set<string>();
const ensureExportDirMock = vi.fn(async () => ({
  getFileHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
    if (!options?.create) {
      if (existingFilesMock.has(_name)) {
        return {
          getFile: vi.fn(async () => new File([''], _name)),
        };
      }
      const error = new Error('Not found');
      (error as Error & { name: string }).name = 'NotFoundError';
      throw error;
    }

    return {
      getFile: vi.fn(async () => new File([''], _name)),
      createWritable: vi.fn(async () => ({
        write: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        abort: vi.fn(async () => undefined),
      })),
    };
  }),
  removeEntry: vi.fn(async () => undefined),
}));

const projectStoreMock = {
  currentFileName: 'timeline.otio',
  currentProjectName: 'Project',
  projectMeta: {
    title: 'Title',
    description: 'Description',
    author: 'Author',
    tags: ['tag-1'],
  },
  projectSettings: {
    exportDefaults: {
      encoding: {
        format: 'mp4',
        videoCodec: 'avc1.42E032',
        bitrateMbps: 8,
        excludeAudio: false,
        audioCodec: 'aac',
        audioBitrateKbps: 192,
        bitrateMode: 'vbr',
        keyframeIntervalSec: 2,
        exportAlpha: false,
      },
    },
    project: {
      sampleRate: 48000,
      width: 1920,
      height: 1080,
      fps: 30,
      resolutionFormat: '1080p',
      orientation: 'landscape',
      aspectRatio: '16:9',
      isCustomResolution: false,
    },
  },
};

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => projectStoreMock,
}));

const timelineFormatMock = ref<any>({
  sampleRate: 48000,
  width: 1920,
  height: 1080,
  fps: 30,
  resolutionFormat: '1080p',
  orientation: 'landscape',
  aspectRatio: '16:9',
  isCustomResolution: false,
  isAutoSettings: false,
  settingsSource: 'manual',
});
const updateTimelineFormatMock = vi.fn();

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => ({
    timelineDoc: { metadata: { fastcat: {} } },
    get timelineFormat() {
      return timelineFormatMock.value;
    },
    updateTimelineFormat: updateTimelineFormatMock,
    getSelectionRange: () => selectionRangeMock.value,
    getMarkers: () => markersMock.value,
  }),
}));

vi.mock('~/stores/selection.store', () => ({
  useSelectionStore: () => ({
    get selectedEntity() {
      return selectedEntityMock.value;
    },
  }),
}));

vi.mock('~/composables/timeline/export', () => ({
  sanitizeBaseName: (name: string) => name.replace(/\.[^.]+$/, ''),
  normalizeExportFilename: (name: string) => name.trim(),
  getExt: (format: string) => format,
  resolveExportCodecs: (format: string, videoCodec: string, audioCodec: string) => ({
    videoCodec,
    audioCodec: format === 'webm' ? 'opus' : audioCodec,
  }),
  supportsExportAlpha: (format: string, _videoCodec?: string) => format === 'webm',
  useTimelineExport: () => ({
    isExporting: ref(false),
    exportProgress: ref(0),
    exportError: ref<string | null>(null),
    exportPhase: ref<string | null>(null),
    exportWarnings: ref<string[]>([]),
    outputFilename: ref(''),
    filenameError: ref<string | null>(null),
    outputFormat: ref<'mp4' | 'webm' | 'mkv'>('mp4'),
    videoCodec: ref('avc1.42E032'),
    bitrateMbps: ref(8),
    excludeAudio: ref(false),
    audioCodec: ref<'aac' | 'opus'>('aac'),
    audioBitrateKbps: ref(192),
    audioChannels: ref(2),
    audioSampleRate: ref(48000),
    exportWidth: ref(1920),
    exportHeight: ref(1080),
    exportFps: ref(30),
    resolutionFormat: ref('1080p'),
    orientation: ref('landscape'),
    aspectRatio: ref('16:9'),
    isCustomResolution: ref(false),
    bitrateMode: ref<'cbr' | 'vbr'>('vbr'),
    keyframeIntervalSec: ref(2),
    exportAlpha: ref(false),
    metadataTitle: ref(''),
    metadataDescription: ref(''),
    metadataAuthor: ref(''),
    metadataTags: ref(''),
    videoCodecSupport: ref({}),
    audioCodecSupport: ref({ aac: true, opus: true }),
    isLoadingCodecSupport: ref(false),
    bitrateBps: ref(8_000_000),
    audioBitrateBps: ref(192_000),
    normalizedExportWidth: ref(1920),
    normalizedExportHeight: ref(1080),
    normalizedExportFps: ref(30),
    ensureExportDir: ensureExportDirMock,
    validateFilename: validateFilenameMock,
    getNextAvailableFilename: getNextAvailableFilenameMock,
    loadCodecSupport: vi.fn(async () => undefined),
    saveProjectSettingsAsDefault: vi.fn(async () => undefined),
    exportTimelineToFile: exportTimelineToFileMock,
    cancelExport: vi.fn(),
    cancelRequested: ref(false),
    resetExportState: vi.fn(),
    exportType: ref<'video' | 'audio'>('video'),
    ext: ref('mp4'),
    matchTimeline: ref(true),
    customWidth: ref(1920),
    customHeight: ref(1080),
    customFps: ref(30),
    customAudioSampleRate: ref(48000),
  }),
}));

describe('useExportForm', () => {
  beforeEach(() => {
    timelineFormatMock.value = {
      sampleRate: 48000,
      width: 1920,
      height: 1080,
      fps: 30,
      resolutionFormat: '1080p',
      orientation: 'landscape',
      aspectRatio: '16:9',
      isCustomResolution: false,
      isAutoSettings: false,
      settingsSource: 'manual',
    };
    updateTimelineFormatMock.mockReset();
    selectionRangeMock.value = null;
    markersMock.value = [];
    selectedEntityMock.value = null;
    exportTimelineToFileMock.mockReset();
    validateFilenameMock.mockClear();
    getNextAvailableFilenameMock.mockClear();
    ensureExportDirMock.mockReset();
    ensureExportDirMock.mockImplementation(async () => ({
      getFileHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
        if (!options?.create) {
          if (existingFilesMock.has(_name)) {
            return {
              getFile: vi.fn(async () => new File([''], _name)),
            };
          }
          const error = new Error('Not found');
          (error as Error & { name: string }).name = 'NotFoundError';
          throw error;
        }

        return {
          getFile: vi.fn(async () => new File([''], _name)),
          createWritable: vi.fn(async () => ({
            write: vi.fn(async () => undefined),
            close: vi.fn(async () => undefined),
            abort: vi.fn(async () => undefined),
          })),
        };
      }),
      removeEntry: vi.fn(async () => undefined),
    }));
    existingFilesMock.clear();
  });

  it('выбирает активный маркер-зону по умолчанию', async () => {
    markersMock.value = [
      { id: 'zone-2', timeUs: 5_000_000, durationUs: 2_000_000, text: 'Outro' },
      { id: 'zone-1', timeUs: 1_000_000, durationUs: 3_000_000, text: 'Intro' },
    ];
    selectedEntityMock.value = {
      source: 'timeline',
      kind: 'marker',
      markerId: 'zone-2',
    };

    const form = useExportForm();
    await form.initializeExportForm();

    expect(form.selectedExportRangeId.value).toBe('marker:zone-2');
    expect(form.exportRangeOptions.value.map((option) => option.id)).toEqual([
      'timeline',
      'marker:zone-1',
      'marker:zone-2',
    ]);
  });

  it('выбирает область выделения по умолчанию, если на таймлайне ничего не выбрано', async () => {
    selectionRangeMock.value = { startUs: 2_000_000, endUs: 6_000_000 };

    const form = useExportForm();
    await form.initializeExportForm();

    expect(form.selectedExportRangeId.value).toBe('selection');
  });

  it('выбирает область выделения по умолчанию, даже если на таймлайне выбран клип', async () => {
    selectionRangeMock.value = { startUs: 2_000_000, endUs: 6_000_000 };
    selectedEntityMock.value = {
      source: 'timeline',
      kind: 'clip',
      trackId: 'v1',
      itemId: 'clip-1',
    };

    const form = useExportForm();
    await form.initializeExportForm();

    expect(form.selectedExportRangeId.value).toBe('selection');
  });

  it('передает диапазон выбранного маркера-зоны в экспорт', async () => {
    markersMock.value = [{ id: 'zone-1', timeUs: 1_500_000, durationUs: 2_500_000, text: '' }];
    selectedEntityMock.value = {
      source: 'timeline',
      kind: 'marker',
      markerId: 'zone-1',
    };

    const form = useExportForm();
    await form.initializeExportForm();
    await form.handleStartExport();

    expect(exportTimelineToFileMock).toHaveBeenCalledTimes(1);
    expect(exportTimelineToFileMock.mock.calls[0]?.[0]).toMatchObject({
      exportRangeUs: {
        startUs: 1_500_000,
        endUs: 4_000_000,
      },
    });
  });

  it('синхронизирует radio с выбором зоны и области выделения после открытия формы', async () => {
    selectionRangeMock.value = { startUs: 2_000_000, endUs: 6_000_000 };
    markersMock.value = [{ id: 'zone-1', timeUs: 1_500_000, durationUs: 2_500_000, text: '' }];

    const form = useExportForm();
    await form.initializeExportForm();

    expect(form.selectedExportRangeId.value).toBe('selection');

    selectedEntityMock.value = {
      source: 'timeline',
      kind: 'marker',
      markerId: 'zone-1',
    };
    await nextTick();

    expect(form.selectedExportRangeId.value).toBe('marker:zone-1');

    selectedEntityMock.value = {
      source: 'timeline',
      kind: 'selection-range',
    };
    await nextTick();

    expect(form.selectedExportRangeId.value).toBe('selection');
  });

  it('сохраняет расширение оригинального файла в имени временного файла', async () => {
    const form = useExportForm();
    await form.initializeExportForm();

    form.outputFilename.value = 'my-video.mkv';

    const getFileHandleMock = vi.fn(async (_name: string, options?: { create?: boolean }) => {
      if (!options?.create) {
        const error = new Error('Not found');
        (error as Error & { name: string }).name = 'NotFoundError';
        throw error;
      }
      return {
        getFile: vi.fn(async () => new File([''], _name)),
        createWritable: vi.fn(async () => ({
          write: vi.fn(async () => undefined),
          close: vi.fn(async () => undefined),
          abort: vi.fn(async () => undefined),
        })),
      };
    });

    ensureExportDirMock.mockResolvedValue({
      getFileHandle: getFileHandleMock,
      removeEntry: vi.fn(async () => undefined),
    } as any);

    await form.handleStartExport();

    const calls = getFileHandleMock.mock.calls;
    const tempFileCall = calls.find((call: any) => call[0].includes('.tmp-'));

    expect(tempFileCall).toBeDefined();
    const tempFilename = tempFileCall[0];
    expect(tempFilename.startsWith('.my-video.tmp-')).toBe(true);
    expect(tempFilename.endsWith('.mkv')).toBe(true);
  });

  it('инициализирует настройки формы из timelineFormat', async () => {
    timelineFormatMock.value = {
      sampleRate: 44100,
      width: 1280,
      height: 720,
      fps: 60,
      resolutionFormat: '720p',
      orientation: 'landscape',
      aspectRatio: '16:9',
      isCustomResolution: false,
      exportFormat: 'webm',
      videoCodec: 'vp9',
      videoBitrateMbps: 12,
      excludeAudio: true,
      audioCodec: 'opus',
      audioBitrateKbps: 128,
      audioChannels: 1,
      bitrateMode: 'cbr',
      keyframeIntervalSec: 5,
      exportAlpha: true,
    };

    const form = useExportForm();
    await form.initializeExportForm();

    expect(form.outputFormat.value).toBe('webm');
    expect(form.videoCodec.value).toBe('vp9');
    expect(form.bitrateMbps.value).toBe(12);
    expect(form.excludeAudio.value).toBe(true);
    expect(form.audioCodec.value).toBe('opus');
    expect(form.audioBitrateKbps.value).toBe(128);
    expect(form.audioChannels.value).toBe(1);
    expect(form.audioSampleRate.value).toBe(44100);
    expect(form.bitrateMode.value).toBe('cbr');
    expect(form.keyframeIntervalSec.value).toBe(5);
    expect(form.exportAlpha.value).toBe(true);
  });

  it('сохраняет настройки в timelineFormat при экспорте, если saveAsDefaults === true', async () => {
    const form = useExportForm();
    await form.initializeExportForm();

    form.saveAsDefaults.value = true;
    form.outputFormat.value = 'mkv';
    form.videoCodec.value = 'hevc';
    form.bitrateMbps.value = 15;
    form.excludeAudio.value = false;
    form.audioCodec.value = 'flac';
    form.audioBitrateKbps.value = 320;
    form.audioChannels.value = 6;
    form.bitrateMode.value = 'vbr';
    form.keyframeIntervalSec.value = 3;
    form.exportAlpha.value = false;

    // Убедимся, что форма грязная, чтобы сохранить настройки
    expect(form.isSettingsDirty.value).toBe(true);

    await form.handleStartExport();

    expect(updateTimelineFormatMock).toHaveBeenCalledTimes(1);
    expect(updateTimelineFormatMock).toHaveBeenCalledWith({
      width: 1920,
      height: 1080,
      fps: 30,
      resolutionFormat: '1080p',
      orientation: 'landscape',
      aspectRatio: '16:9',
      isCustomResolution: false,
      sampleRate: 48000,
      exportFormat: 'mkv',
      videoCodec: 'hevc',
      videoBitrateMbps: 15,
      excludeAudio: false,
      audioCodec: 'flac',
      audioBitrateKbps: 320,
      audioChannels: 6,
      bitrateMode: 'vbr',
      keyframeIntervalSec: 3,
      exportAlpha: false,
    });
  });

  it('сбрасывает экспорт альфа-канала при переключении с webm на mp4', async () => {
    const form = useExportForm();
    await form.initializeExportForm();

    form.outputFormat.value = 'webm';
    form.exportAlpha.value = true;
    form.outputFormat.value = 'mp4';
    form.handleOutputFormatChange('mp4');

    expect(form.exportAlpha.value).toBe(false);
  });

  it('не передает exportAlpha в mp4 payload, даже если состояние осталось true', async () => {
    const form = useExportForm();
    await form.initializeExportForm();

    form.outputFormat.value = 'mp4';
    form.exportAlpha.value = true;

    await form.handleStartExport();

    expect(exportTimelineToFileMock.mock.calls[0]?.[0]).toMatchObject({
      format: 'mp4',
      exportAlpha: false,
    });
  });
});
