/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useExportForm } from '~/composables/timeline/export/useExportForm';

const selectionRangeMock = ref<{ startUs: number; endUs: number } | null>(null);
const markersMock = ref<
  Array<{ id: string; timeUs: number; durationUs?: number; text: string; color?: string }>
>([]);
const selectedEntityMock = ref<any>(null);

const exportTimelineToFileMock = vi.fn();
const validateFilenameMock = vi.fn(async () => true);
const getNextAvailableFilenameMock = vi.fn(async () => 'timeline.mp4');
const ensureExportDirMock = vi.fn(async () => ({
  getFileHandle: vi.fn(async (_name: string, options?: { create?: boolean }) => {
    if (!options?.create) {
      const error = new Error('Not found');
      (error as Error & { name: string }).name = 'NotFoundError';
      throw error;
    }

    return {
      getFile: vi.fn(async () => new File([''], 'timeline.mp4')),
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

vi.mock('~/stores/timeline.store', () => ({
  useTimelineStore: () => ({
    timelineDoc: { metadata: { fastcat: {} } },
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
  getExt: (format: string) => format,
  resolveExportCodecs: (format: string, videoCodec: string, audioCodec: string) => ({
    videoCodec,
    audioCodec: format === 'webm' ? 'opus' : audioCodec,
  }),
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
    isLoadingCodecSupport: ref(false),
    bitrateBps: ref(8_000_000),
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
  }),
}));

describe('useExportForm', () => {
  beforeEach(() => {
    selectionRangeMock.value = null;
    markersMock.value = [];
    selectedEntityMock.value = null;
    exportTimelineToFileMock.mockReset();
    validateFilenameMock.mockClear();
    getNextAvailableFilenameMock.mockClear();
    ensureExportDirMock.mockClear();
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

  it('использует весь таймлайн по умолчанию, если нет активной зоны или выделения', async () => {
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
});
