import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mountWithNuxt } from '../../utils/mount';
import FileProperties from '~/components/properties/FileProperties.vue';

// Mock all internal composables used by FileProperties.vue
vi.mock('~/composables/file-manager/useEntryPreview', () => ({
  useEntryPreview: vi.fn(() => ({
    currentUrl: ref('http://example.com/test.mp4'),
    mediaType: ref('video'),
    textContent: ref(''),
    fileInfo: ref({
      kind: 'file',
      name: 'test.mp4',
      size: 1024 * 1024 * 100, // 100MB
      lastModified: Date.now(),
      mimeType: 'video/mp4',
    }),
    exifData: ref(null),
    exifYaml: ref(null),
    imageDimensions: ref(null),
    timelineDocSummary: ref(null),
    lineCount: ref(null),
    metadataYaml: ref('Format: MPEG-4\nDuration: 00:01:00\n'),
    isUnknown: ref(false),
    isOtio: ref(false),
  })),
}));

vi.mock('~/composables/properties/useFilePropertiesBasics', () => ({
  useFilePropertiesBasics: vi.fn(() => ({
    generalInfoTitle: 'General Info',
    isHidden: ref(false),
    mediaMeta: ref({}),
    selectedPath: ref('/projects/test.mp4'),
    isBloggerDogProject: ref(false),
    isBloggerDogGroup: ref(false),
    isBloggerDogContentItem: ref(false),
    isBloggerDogMedia: ref(false),
    bloggerDogDeepLink: ref(null),
  })),
}));

vi.mock('~/composables/properties/useFileStorageInfo', () => ({
  useFileStorageInfo: vi.fn(() => ({
    isProjectRootDir: ref(false),
    storageFreeBytes: ref(1024 * 1024 * 1024 * 100), // 100GB
    projectStats: ref({
      fileCount: 10,
      totalSizeBytes: 1024 * 1024 * 500,
    }),
  })),
}));

vi.mock('~/composables/properties/useFileTimelineUsage', () => ({
  useFileTimelineUsage: vi.fn(() => ({
    timelinesUsingSelectedFile: ref([]),
    openTimelineFromUsage: vi.fn(),
  })),
}));

vi.mock('~/composables/properties/useFileProxyFolder', () => ({
  useFileProxyFolder: vi.fn(() => ({
    generateProxiesForSelectedFolder: vi.fn(),
    isFolderWithVideo: ref(false),
    isGeneratingProxyForFolder: ref(false),
    stopProxyGenerationForSelectedFolder: vi.fn(),
  })),
}));

vi.mock('~/composables/properties/useFilePropertiesHandlers', () => ({
  useFilePropertiesHandlers: vi.fn(() => ({
    canOpenAsPanel: ref(false),
    canOpenAsProjectTab: ref(false),
    openAsProjectTab: vi.fn(),
    createSubfolder: vi.fn(),
    createTimelineInFolder: vi.fn(),
    createMarkdownInFolder: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    openAsTextPanel: vi.fn(),
    openRemoteUploadPicker: vi.fn(),
  })),
}));

vi.mock('~/composables/properties/useFilePropertiesActions', () => ({
  useFilePropertiesActions: vi.fn(() => ({
    directoryPrimaryActions: ref([]),
    directorySecondaryActions: ref([]),
    filePrimaryActions: ref([{ id: 'mock', title: 'Mock Action', onClick: vi.fn() }]),
    fileSecondaryActions: ref([]),
  })),
}));

vi.mock('~/composables/file-manager/useFileManager', () => ({
  useFileManager: vi.fn(() => ({
    vfs: {
      getFile: vi.fn(),
    },
    handleFiles: vi.fn(),
    loadProjectDirectory: vi.fn(),
    findEntryByPath: vi.fn(),
    copyEntry: vi.fn(),
    moveEntry: vi.fn(),
  })),
}));

vi.mock('~/composables/file-manager/useComputerVfs', () => ({
  useComputerVfs: vi.fn(() => ({
    vfs: ref({
      getFile: vi.fn(),
    }),
  })),
}));

vi.mock('~/composables/properties/useImageExifInfo', () => ({
  useImageExifInfo: vi.fn(() => ({
    hasImageInfo: ref(false),
    imageCameraMake: ref(null),
    imageCreateDate: ref(null),
    imageLocationLink: ref(null),
    imageResolution: ref(null),
  })),
}));

vi.mock('~/composables/properties/useFilePropertiesTranscription', () => ({
  useFilePropertiesTranscription: vi.fn(() => ({
    canTranscribeMedia: ref(false),
    isTranscriptionModalOpen: ref(false),
    transcriptionLanguage: ref('en'),
    isTranscribingAudio: ref(false),
    isSttModelReady: ref(true),
    transcriptionError: ref(''),
    latestTranscriptionText: ref(''),
    latestTranscriptionCacheKey: ref(''),
    latestTranscriptionWasCached: ref(false),
    openTranscriptionModal: vi.fn(),
    submitAudioTranscription: vi.fn(),
  })),
}));

vi.mock('~/composables/properties/useFileTimelineUsage', () => ({
  useFileTimelineUsage: vi.fn(() => ({
    timelinesUsingSelectedFile: ref([]),
    openTimelineFromUsage: vi.fn(),
  })),
}));

describe('FileProperties.vue', () => {
  it('renders properties for a video file', async () => {
    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: { kind: 'file', name: 'test.mp4', path: '/projects/test.mp4' } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    // Expect Actions Section
    expect(component.text()).toContain('Actions');
    // Using title attribute because primary actions are icon-only in EntryActions
    expect(component.find('button[title="Mock Action"]').exists()).toBe(true);

    // Expect Meta Section
    expect(component.text()).toContain('Meta');
  });

  it('renders properties for a directory', async () => {
    // Override useEntryPreview for directory
    const { useEntryPreview } = await import('~/composables/file-manager/useEntryPreview');
    vi.mocked(useEntryPreview).mockReturnValue({
      currentUrl: ref(null),
      mediaType: ref('directory' as any),
      textContent: ref(''),
      fileInfo: ref({
        kind: 'directory',
        name: 'test_folder',
        size: 0,
        lastModified: Date.now(),
      } as any),
      exifData: ref(null),
      exifYaml: ref(null),
      imageDimensions: ref(null),
      timelineDocSummary: ref(null),
      lineCount: ref(null),
      metadataYaml: ref(null),
      isUnknown: ref(false),
      isOtio: ref(false),
    });

    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: {
          kind: 'directory',
          name: 'test_folder',
          path: '/projects/test_folder',
        } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    // For directory, EntryPreviewBox is hidden
    expect(component.findComponent({ name: 'EntryPreviewBox' }).exists()).toBe(false);

    // General info section should be visible
    expect(component.text()).toContain('General Info');
  });

  it('renders properties for the project root', async () => {
    const { useFileStorageInfo } = await import('~/composables/properties/useFileStorageInfo');
    const { useEntryPreview } = await import('~/composables/file-manager/useEntryPreview');

    vi.mocked(useFileStorageInfo).mockReturnValue({
      isProjectRootDir: ref(true),
      storageFreeBytes: ref(1024 * 1024 * 1024 * 50),
      projectStats: ref({
        fileCount: 42,
        size: 1024 * 1024 * 1024 * 5,
      } as any),
    });

    vi.mocked(useEntryPreview).mockReturnValue({
      currentUrl: ref(null),
      mediaType: ref(null),
      textContent: ref(''),
      fileInfo: ref({
        kind: 'directory',
        name: 'Project Root',
        lastModified: Date.now(),
      } as any),
      exifData: ref(null),
      exifYaml: ref(null),
      imageDimensions: ref(null),
      timelineDocSummary: ref(null),
      lineCount: ref(null),
      metadataYaml: ref(null),
      isUnknown: ref(false),
      isOtio: ref(false),
    });

    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: { kind: 'directory', name: 'root', path: '' } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    // Check for title of project root section
    expect(component.text()).toContain('Project root');
    expect(component.text()).toContain('5 GB'); // totalSizeBytes
  });

  it('renders properties for the common root', async () => {
    const { useEntryPreview } = await import('~/composables/file-manager/useEntryPreview');

    vi.mocked(useEntryPreview).mockReturnValue({
      currentUrl: ref(null),
      mediaType: ref(null),
      textContent: ref(''),
      fileInfo: ref({
        kind: 'directory',
        name: 'common',
        lastModified: Date.now(),
      } as any),
      exifData: ref(null),
      exifYaml: ref(null),
      imageDimensions: ref(null),
      timelineDocSummary: ref(null),
      lineCount: ref(null),
      metadataYaml: ref(null),
      isUnknown: ref(false),
      isOtio: ref(false),
    });

    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: { kind: 'directory', name: 'common', path: 'common' } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    // For common root, it should show typical directory actions
    expect(component.text()).toContain('Actions');
  });

  it('renders properties for an image file with EXIF', async () => {
    const { useEntryPreview } = await import('~/composables/file-manager/useEntryPreview');
    const { useImageExifInfo } = await import('~/composables/properties/useImageExifInfo');

    vi.mocked(useEntryPreview).mockReturnValue({
      currentUrl: ref('http://example.com/test.jpg'),
      mediaType: ref('image'),
      textContent: ref(''),
      fileInfo: ref({
        kind: 'file',
        name: 'test.jpg',
        size: 1024 * 500,
        lastModified: Date.now(),
      } as any),
      exifData: ref({}),
      exifYaml: ref('Camera: Sony\n'),
      imageDimensions: ref({ width: 1920, height: 1080 }),
      timelineDocSummary: ref(null),
      lineCount: ref(null),
      metadataYaml: ref(null),
      isUnknown: ref(false),
      isOtio: ref(false),
    });

    vi.mocked(useImageExifInfo).mockReturnValue({
      hasImageInfo: ref(true),
      imageCameraMake: ref('Sony'),
      imageCreateDate: ref('2023-01-01'),
      imageLocationLink: ref('https://maps.google.com'),
      imageResolution: ref('1920x1080'),
    });

    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: { kind: 'file', name: 'test.jpg', path: '/projects/test.jpg' } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    expect(component.text()).toContain('Resolution');
    expect(component.text()).toContain('1920x1080');
    expect(component.text()).toContain('Sony');
    expect(component.text()).toContain('EXIF');
  });

  it('renders transcription section for audio/video files', async () => {
    const { useEntryPreview } = await import('~/composables/file-manager/useEntryPreview');
    const { useFilePropertiesTranscription } =
      await import('~/composables/properties/useFilePropertiesTranscription');

    vi.mocked(useEntryPreview).mockReturnValue({
      currentUrl: ref('http://example.com/test.mp4'),
      mediaType: ref('video'),
      textContent: ref(''),
      fileInfo: ref({
        kind: 'file',
        name: 'test.mp4',
        size: 1024 * 1024,
      } as any),
      exifData: ref(null),
      exifYaml: ref(null),
      imageDimensions: ref(null),
      timelineDocSummary: ref(null),
      lineCount: ref(null),
      metadataYaml: ref(''),
      isUnknown: ref(false),
      isOtio: ref(false),
    });

    vi.mocked(useFilePropertiesTranscription).mockReturnValue({
      canTranscribeMedia: ref(true),
      isTranscriptionModalOpen: ref(false),
      transcriptionLanguage: ref('en'),
      isTranscribingAudio: ref(false),
      isSttModelReady: ref(true),
      transcriptionError: ref(''),
      latestTranscriptionText: ref('Transcribed text'),
      latestTranscriptionCacheKey: ref('cache-key'),
      latestTranscriptionWasCached: ref(true),
      openTranscriptionModal: vi.fn(),
      submitAudioTranscription: vi.fn(),
    });

    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: { kind: 'file', name: 'test.mp4', path: 'video/test.mp4' } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    // UTextarea might not render its value as text(), so we check the component or the textarea element
    expect(component.findComponent({ name: 'UTextarea' }).props('modelValue')).toBe(
      'Transcribed text',
    );
  });

  it('renders timeline usage section', async () => {
    const { useFileTimelineUsage } = await import('~/composables/properties/useFileTimelineUsage');

    vi.mocked(useFileTimelineUsage).mockReturnValue({
      timelinesUsingSelectedFile: ref([
        { timelinePath: 'timeline1.otio', timelineName: 'Timeline 1' },
      ]),
      openTimelineFromUsage: vi.fn(),
    });

    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: { kind: 'file', name: 'test.mp4', path: '/projects/test.mp4' } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    expect(useFileTimelineUsage).toHaveBeenCalled();
  });

  it('hides timeline usage section for external files', async () => {
    const { useFileTimelineUsage } = await import('~/composables/properties/useFileTimelineUsage');

    vi.mocked(useFileTimelineUsage).mockReturnValue({
      timelinesUsingSelectedFile: ref([
        { timelinePath: 'timeline1.otio', timelineName: 'Timeline 1' },
      ]),
      openTimelineFromUsage: vi.fn(),
    });

    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: { kind: 'file', name: 'test.mp4', path: '/workspace/test.mp4' } as any,
        previewMode: 'original',
        hasProxy: false,
        instanceId: 'computer',
        isExternal: true,
      },
    });

    expect(component.text()).not.toContain('Timeline 1');
  });

  it('renders simplified actions for workspace root', async () => {
    const { useEntryPreview } = await import('~/composables/file-manager/useEntryPreview');

    vi.mocked(useEntryPreview).mockReturnValue({
      currentUrl: ref(null),
      mediaType: ref(null),
      textContent: ref(''),
      fileInfo: ref({
        kind: 'directory',
        name: 'Workspace',
        lastModified: Date.now(),
      } as any),
      exifData: ref(null),
      exifYaml: ref(null),
      imageDimensions: ref(null),
      timelineDocSummary: ref(null),
      lineCount: ref(null),
      metadataYaml: ref(null),
      isUnknown: ref(false),
      isOtio: ref(false),
    });

    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: { kind: 'directory', name: 'Workspace', path: '' } as any,
        previewMode: 'original',
        hasProxy: false,
        instanceId: 'computer',
        isExternal: true,
      },
    });

    expect(component.text()).toContain('Actions');
    expect(component.text()).not.toContain('General Info');
  });
});
