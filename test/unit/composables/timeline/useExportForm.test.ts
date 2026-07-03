/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, computed } from 'vue';
import { useToast } from '#ui/composables/useToast';
import { copyFile, rename } from '@tauri-apps/plugin-fs';
import { useExportForm } from '~/composables/timeline/export/useExportForm';

const { copyFileMock, renameMock } = vi.hoisted(() => ({
  copyFileMock: vi.fn().mockResolvedValue(undefined),
  renameMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  copyFile: copyFileMock,
  rename: renameMock,
}));

const selectionRangeMock = ref<{ startUs: number; endUs: number } | null>(null);
const markersMock = ref<
  Array<{ id: string; timeUs: number; durationUs?: number; text: string; color?: string }>
>([]);
const selectedEntityMock = ref<any>(null);

const mockExportType = ref<'video' | 'audio'>('video');
const mockAudioCodec = ref<'aac' | 'opus' | 'flac' | 'pcm' | 'mp3'>('aac');
const mockOutputFormat = ref<'mp4' | 'webm' | 'mkv'>('mp4');
const mockAudioSampleRate = ref<number>(48000);

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
    exportSettings: undefined as any,
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

const workspaceStoreMock = {
  userSettings: {
    exportPresets: {
      selectedPresetId: 'optimal',
      items: [
        {
          id: 'optimal',
          name: 'Optimal',
          format: 'mkv',
          videoCodec: 'av01.0.05M.08',
          bitrateMbps: 5,
          excludeAudio: false,
          audioCodec: 'opus',
          audioBitrateKbps: 128,
          bitrateMode: 'variable',
          keyframeIntervalSec: 2,
          exportAlpha: false,
          fastStart: true,
        },
      ],
    },
  },
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStoreMock,
}));

vi.mock('~/composables/timeline/export', () => ({
  sanitizeBaseName: (name: string) => name.replace(/\.[^.]+$/, ''),
  normalizeExportFilename: (name: string) => name.trim(),
  getExt: (format: string) => format,
  resolveExportCodecs: (format: string, videoCodec: string, audioCodec: string) => ({
    videoCodec,
    audioCodec: format === 'webm' ? 'opus' : audioCodec,
  }),
  resolveAudioExportSampleRate: ({
    format,
    audioCodec,
    sampleRate,
  }: {
    format: string;
    audioCodec?: string;
    sampleRate?: number;
  }) =>
    audioCodec === 'opus' || format === 'opus' || format === 'ogg' || format === 'webm'
      ? 48000
      : sampleRate,
  supportsExportAlpha: (format: string, _videoCodec?: string) => format === 'webm',
  useTimelineExport: () => ({
    isExporting: ref(false),
    exportProgress: ref(0),
    exportError: ref<string | null>(null),
    exportPhase: ref<string | null>(null),
    exportWarnings: ref<string[]>([]),
    exportDurationMs: ref<number | null>(null),
    lastExportStatus: ref<'success' | 'error' | null>(null),
    outputFilename: ref(''),
    filenameError: ref<string | null>(null),
    exportType: mockExportType,
    outputFormat: mockOutputFormat,
    videoCodec: ref('avc1.42E032'),
    bitrateMbps: ref(8),
    excludeAudio: ref(false),
    audioCodec: mockAudioCodec,
    audioBitrateKbps: ref(192),
    audioChannels: ref(2),
    audioSampleRate: mockAudioSampleRate,
    exportWidth: ref(1920),
    exportHeight: ref(1080),
    exportFps: ref(30),
    resolutionFormat: ref('1080p'),
    orientation: ref('landscape'),
    aspectRatio: ref('16:9'),
    isCustomResolution: ref(false),
    bitrateMode: ref<'constant' | 'variable'>('variable'),
    enableAdvancedSettings: ref(false),
    maxBitrateMbps: ref<number | null>(null),
    minBitrateMbps: ref<number | null>(null),
    keyframeIntervalSec: ref(2),
    exportAlpha: ref(false),
    fastStart: ref(true),
    includeMetadata: ref(false),
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
    exportType: mockExportType,
    ext: computed(() => {
      if (mockExportType.value === 'audio') {
        if (mockAudioCodec.value === 'opus') return 'opus';
        if (mockAudioCodec.value === 'flac') return 'flac';
        if (mockAudioCodec.value === 'pcm') return 'wav';
        if (mockAudioCodec.value === 'mp3') return 'mp3';
        return 'aac';
      }
      return mockOutputFormat.value;
    }),
    matchTimeline: ref(true),
    customWidth: ref(1920),
    customHeight: ref(1080),
    customFps: ref(30),
    customAudioSampleRate: ref(48000),
  }),
}));

describe('useExportForm', () => {
  afterEach(async () => {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
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
    copyFileMock.mockReset();
    renameMock.mockReset();
    selectionRangeMock.value = null;
    markersMock.value = [];
    selectedEntityMock.value = null;
    exportTimelineToFileMock.mockReset();
    validateFilenameMock.mockClear();
    getNextAvailableFilenameMock.mockReset();
    getNextAvailableFilenameMock.mockResolvedValue('timeline.mp4');
    mockExportType.value = 'video';
    mockAudioCodec.value = 'aac';
    mockOutputFormat.value = 'mp4';
    mockAudioSampleRate.value = 48000;
    // Flush watchers triggered by mock value resets so stale watchers
    // from previous useExportForm() calls don't overwrite exportSettings
    // during the next initializeExportForm call
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.mocked(copyFile).mockClear();
    projectStoreMock.projectSettings.exportSettings = undefined as any;
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
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
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

  it('передает цвета маркеров в опции экспорта', async () => {
    markersMock.value = [
      { id: 'zone-1', timeUs: 1_000_000, durationUs: 3_000_000, text: 'Intro', color: '#ff0000' },
      { id: 'zone-2', timeUs: 5_000_000, durationUs: 2_000_000, text: 'Outro' },
    ];

    const form = useExportForm();
    await form.initializeExportForm();

    expect(form.exportRangeOptions.value).toEqual([
      {
        id: 'timeline',
        label: 'videoEditor.export.wholeTimeline',
      },
      {
        id: 'marker:zone-1',
        label: 'videoEditor.export.zoneMarker',
        description: 'Intro',
        range: { startUs: 1_000_000, endUs: 4_000_000 },
        color: '#ff0000',
      },
      {
        id: 'marker:zone-2',
        label: 'videoEditor.export.zoneMarker',
        description: 'Outro',
        range: { startUs: 5_000_000, endUs: 7_000_000 },
        color: undefined,
      },
    ]);
  });

  it('не выбирает область выделения по умолчанию, если она не активна', async () => {
    selectionRangeMock.value = { startUs: 2_000_000, endUs: 6_000_000 };

    const form = useExportForm();
    await form.initializeExportForm();

    expect(form.selectedExportRangeId.value).toBe('timeline');
  });

  it('не выбирает область выделения по умолчанию, если на таймлайне выбран клип', async () => {
    selectionRangeMock.value = { startUs: 2_000_000, endUs: 6_000_000 };
    selectedEntityMock.value = {
      source: 'timeline',
      kind: 'clip',
      trackId: 'v1',
      itemId: 'clip-1',
    };

    const form = useExportForm();
    await form.initializeExportForm();

    expect(form.selectedExportRangeId.value).toBe('timeline');
  });

  it('выбирает область выделения по умолчанию только когда она активна', async () => {
    selectionRangeMock.value = { startUs: 2_000_000, endUs: 6_000_000 };
    selectedEntityMock.value = {
      source: 'timeline',
      kind: 'selection-range',
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

    expect(form.selectedExportRangeId.value).toBe('timeline');

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

  it('инициализирует настройки формы из export preset по умолчанию', async () => {
    timelineFormatMock.value = {
      sampleRate: 44100,
      width: 1280,
      height: 720,
      fps: 60,
      resolutionFormat: '720p',
      orientation: 'landscape',
      aspectRatio: '16:9',
      isCustomResolution: false,
    };

    const form = useExportForm();
    await form.initializeExportForm();

    expect(form.outputFormat.value).toBe('mkv');
    expect(form.videoCodec.value).toBe('av01.0.05M.08');
    expect(form.bitrateMbps.value).toBe(5);
    expect(form.excludeAudio.value).toBe(false);
    expect(form.audioCodec.value).toBe('opus');
    expect(form.audioBitrateKbps.value).toBe(128);
    expect(form.audioChannels.value).toBe(2);
    expect(form.audioSampleRate.value).toBe(44100);
    expect(form.bitrateMode.value).toBe('variable');
    expect(form.keyframeIntervalSec.value).toBe(2);
    expect(form.exportAlpha.value).toBe(false);
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

  it('записывает длительность и статус успеха после экспорта', async () => {
    const form = useExportForm();
    await form.initializeExportForm();
    await form.handleStartExport();

    expect(form.lastExportStatus.value).toBe('success');
    expect(form.exportDurationMs.value).not.toBeNull();
    expect(form.exportDurationMs.value).toBeGreaterThanOrEqual(0);
  });

  it('в Tauri финализирует экспорт через native rename с фолбэком на copyFile', async () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const tempGetFileMock = vi.fn(async () => {
      throw new Error('temp getFile should not be called');
    });
    const finalGetFileMock = vi.fn(async () => {
      throw new Error('final getFile should not be called');
    });
    const finalCreateWritableMock = vi.fn(async () => {
      throw new Error('createWritable should not be called');
    });
    const getFileHandleMock = vi.fn(async (name: string, options?: { create?: boolean }) => {
      if (!options?.create) {
        const error = new Error('Not found');
        (error as Error & { name: string }).name = 'NotFoundError';
        throw error;
      }
      if (name.includes('.tmp-')) {
        return {
          path: `/project/_export/${name}`,
          getFile: tempGetFileMock,
        };
      }
      return {
        path: `/project/_export/${name}`,
        getFile: finalGetFileMock,
        createWritable: finalCreateWritableMock,
      };
    });
    ensureExportDirMock.mockResolvedValue({
      getFileHandle: getFileHandleMock,
      removeEntry: vi.fn(async () => undefined),
    } as any);
    vi.mocked(rename).mockResolvedValue(undefined);
    vi.mocked(copyFile).mockResolvedValue(undefined);
    const onSuccess = vi.fn();

    const form = useExportForm();
    await form.initializeExportForm();
    await form.handleStartExport(onSuccess);

    expect(rename).toHaveBeenCalledTimes(1);
    const [fromPath, toPath] = vi.mocked(rename).mock.calls[0]!;
    expect(String(fromPath)).toContain('.tmp-');
    expect(toPath).toBe('/project/_export/timeline.mp4');
    expect(copyFile).not.toHaveBeenCalled();
    expect(tempGetFileMock).not.toHaveBeenCalled();
    expect(finalGetFileMock).not.toHaveBeenCalled();
    expect(finalCreateWritableMock).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith(expect.any(File));
    expect(onSuccess.mock.calls[0]?.[0].size).toBe(0);
  });

  it('в Tauri откатывается на copyFile, если rename возвращает ошибку', async () => {
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
    const getFileHandleMock = vi.fn(async (name: string, options?: { create?: boolean }) => {
      if (!options?.create) {
        const error = new Error('Not found');
        (error as Error & { name: string }).name = 'NotFoundError';
        throw error;
      }
      return {
        path: `/project/_export/${name}`,
        getFile: vi.fn(),
        createWritable: vi.fn(),
      };
    });
    ensureExportDirMock.mockResolvedValue({
      getFileHandle: getFileHandleMock,
      removeEntry: vi.fn(async () => undefined),
    } as any);
    vi.mocked(rename).mockRejectedValueOnce(new Error('EXDEV: cross-device link not permitted'));
    vi.mocked(copyFile).mockResolvedValue(undefined);

    const form = useExportForm();
    await form.initializeExportForm();
    await form.handleStartExport();

    expect(rename).toHaveBeenCalledTimes(1);
    expect(copyFile).toHaveBeenCalledTimes(1);
  });

  it('в веб-версии использует move() у FileSystemFileHandle если метод доступен', async () => {
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    const moveMock = vi.fn(async () => undefined);
    const tempFileHandleObj = {
      getFile: vi.fn(async () => new File(['data'], 'temp.mp4')),
      move: moveMock,
    };
    const getFileHandleMock = vi.fn(async (name: string, options?: { create?: boolean }) => {
      if (!options?.create) {
        const error = new Error('Not found');
        (error as Error & { name: string }).name = 'NotFoundError';
        throw error;
      }
      if (name.includes('.tmp-')) {
        return tempFileHandleObj;
      }
      return {
        getFile: vi.fn(async () => new File(['data'], name)),
        createWritable: vi.fn(),
      };
    });
    ensureExportDirMock.mockResolvedValue({
      getFileHandle: getFileHandleMock,
      removeEntry: vi.fn(async () => undefined),
    } as any);

    const form = useExportForm();
    await form.initializeExportForm();
    await form.handleStartExport();

    expect(moveMock).toHaveBeenCalledWith('timeline.mp4');
  });

  it('показывает тост успеха с длительностью экспорта', async () => {
    const toastAddMock = vi.fn();
    vi.mocked(useToast).mockReturnValue({ add: toastAddMock, remove: vi.fn() });

    const form = useExportForm();
    await form.initializeExportForm();
    await form.handleStartExport();

    expect(toastAddMock).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'success',
        description: expect.stringContaining('videoEditor.export.successDescWithDuration'),
      }),
    );
  });

  it('записывает длительность и статус ошибки при неудачном экспорте', async () => {
    exportTimelineToFileMock.mockRejectedValueOnce(new Error('Codec error'));

    const form = useExportForm();
    await form.initializeExportForm();
    await form.handleStartExport();

    expect(form.lastExportStatus.value).toBe('error');
    expect(form.exportDurationMs.value).not.toBeNull();
    expect(form.exportDurationMs.value).toBeGreaterThanOrEqual(0);
  });

  it('показывает тост ошибки с длительностью при неудачном экспорте', async () => {
    exportTimelineToFileMock.mockRejectedValueOnce(new Error('Codec error'));
    const toastAddMock = vi.fn();
    vi.mocked(useToast).mockReturnValue({ add: toastAddMock, remove: vi.fn() });

    const form = useExportForm();
    await form.initializeExportForm();
    await form.handleStartExport();

    expect(toastAddMock).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'error',
        description: expect.stringContaining('videoEditor.export.errorDescWithDuration'),
      }),
    );
  });

  it('генерирует имя файла с аудио-расширением при инициализации аудио-экспорта', async () => {
    projectStoreMock.projectSettings.exportSettings = {
      exportType: 'audio',
      outputFormat: 'mp4',
      videoCodec: 'avc1.42E032',
      bitrateMbps: 8,
      excludeAudio: false,
      audioCodec: 'opus',
      audioBitrateKbps: 192,
      audioSampleRate: 48000,
      bitrateMode: 'vbr',
      keyframeIntervalSec: 2,
      exportAlpha: false,
      matchTimeline: true,
      customWidth: 1920,
      customHeight: 1080,
      customFps: 30,
      customAudioSampleRate: 48000,
      metadataTitle: '',
      metadataDescription: '',
      metadataAuthor: '',
      metadataTags: '',
    };

    getNextAvailableFilenameMock.mockImplementation(async () => 'timeline.opus');

    const form = useExportForm();
    await form.initializeExportForm();

    expect(getNextAvailableFilenameMock).toHaveBeenCalledWith('timeline', 'opus');
    expect(form.outputFilename.value).toBe('timeline.opus');
  });

  it('экспортирует Opus с частотой 48 kHz даже если проект настроен на 44.1 kHz', async () => {
    projectStoreMock.projectSettings.exportSettings = {
      exportType: 'audio',
      audioCodec: 'opus',
      audioSampleRate: 44100,
      bitrateMbps: 8,
      excludeAudio: false,
      audioBitrateKbps: 192,
      bitrateMode: 'vbr',
      keyframeIntervalSec: 2,
      exportAlpha: false,
      matchTimeline: true,
      customWidth: 1920,
      customHeight: 1080,
      customFps: 30,
      customAudioSampleRate: 44100,
      metadataTitle: '',
      metadataDescription: '',
      metadataAuthor: '',
      metadataTags: '',
    };

    getNextAvailableFilenameMock.mockResolvedValue('timeline.opus');

    const form = useExportForm();
    await form.initializeExportForm();
    form.exportType.value = 'audio';
    form.audioCodec.value = 'opus';
    form.audioSampleRate.value = 44100;
    form.outputFilename.value = 'timeline.opus';
    exportTimelineToFileMock.mockClear();
    await form.handleStartExport();

    expect(exportTimelineToFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        format: 'opus',
        audioCodec: 'opus',
        audioSampleRate: 48000,
      }),
      expect.anything(),
      expect.any(Function),
    );
  });

  it('инициализирует includeMetadata как false и не передает метаданные по умолчанию', async () => {
    const form = useExportForm();
    await form.initializeExportForm();
    expect(form.includeMetadata.value).toBe(false);

    exportTimelineToFileMock.mockClear();
    await form.handleStartExport();

    expect(exportTimelineToFileMock.mock.calls[0]?.[0]).toMatchObject({
      metadata: undefined,
    });
  });

  it('передает метаданные, если includeMetadata установлен в true', async () => {
    const form = useExportForm();
    await form.initializeExportForm();
    form.includeMetadata.value = true;
    form.metadataTitle.value = 'Custom Title';

    exportTimelineToFileMock.mockClear();
    await form.handleStartExport();

    expect(exportTimelineToFileMock.mock.calls[0]?.[0]).toMatchObject({
      metadata: {
        title: 'Custom Title',
        description: 'Description',
        author: 'Author',
        tags: 'tag-1',
      },
    });
  });

  it('сохраняет и загружает параметр audioChannels', async () => {
    const form = useExportForm();
    await form.initializeExportForm();

    // Изменяем каналы на 1 (mono)
    form.audioChannels.value = 1;
    await nextTick();

    // Настройки должны были сохраниться в стор
    expect(projectStoreMock.projectSettings.exportSettings?.audioChannels).toBe(1);

    // Сбросим состояние формы
    form.audioChannels.value = 2;

    // Снова инициализируем форму
    await form.initializeExportForm();

    // Каналы должны восстановиться из сохраненных настроек
    expect(form.audioChannels.value).toBe(1);
  });

  it('использует дефолтные параметры кодирования при выключенных дополнительных настройках', async () => {
    const form = useExportForm();
    await form.initializeExportForm();

    form.enableAdvancedSettings.value = false;
    form.bitrateMode.value = 'constant';
    form.keyframeIntervalSec.value = 5;
    form.fastStart.value = true;
    form.maxBitrateMbps.value = 12;

    exportTimelineToFileMock.mockClear();
    await form.handleStartExport();

    expect(exportTimelineToFileMock.mock.calls[0]?.[0]).toMatchObject({
      bitrateMode: 'variable',
      maxBitrateBps: null,
      minBitrateBps: null,
      keyframeIntervalSec: 2,
      fastStart: false,
    });
  });

  it('передает продвинутые параметры кодирования при включенных дополнительных настройках', async () => {
    const form = useExportForm();
    await form.initializeExportForm();

    form.enableAdvancedSettings.value = true;
    form.bitrateMode.value = 'variable';
    form.maxBitrateMbps.value = 12;
    form.minBitrateMbps.value = 3;
    form.keyframeIntervalSec.value = 5;
    form.fastStart.value = true;

    exportTimelineToFileMock.mockClear();
    await form.handleStartExport();

    expect(exportTimelineToFileMock.mock.calls[0]?.[0]).toMatchObject({
      bitrateMode: 'variable',
      maxBitrateBps: 12_000_000,
      minBitrateBps: 3_000_000,
      keyframeIntervalSec: 5,
      fastStart: true,
    });
  });
});
