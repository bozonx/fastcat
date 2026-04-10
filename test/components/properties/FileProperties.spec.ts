import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mountWithNuxt } from '../../utils/mount';
import FileProperties from '~/components/properties/FileProperties.vue';

vi.mock('~/components/preview/TextEditor.vue', () => ({
  default: {
    name: 'TextEditor',
    props: ['filePath', 'fileName'],
    template: '<div data-testid="text-editor-stub">{{ fileName }}|{{ filePath }}</div>',
  },
}));

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

  it('renders dedicated actions for BloggerDog virtual roots and project', async () => {
    const { useEntryPreview } = await import('~/composables/file-manager/useEntryPreview');
    const { useFilePropertiesBasics } =
      await import('~/composables/properties/useFilePropertiesBasics');
    const { useFilePropertiesActions } =
      await import('~/composables/properties/useFilePropertiesActions');

    vi.mocked(useEntryPreview).mockReturnValue({
      currentUrl: ref(null),
      mediaType: ref(null),
      textContent: ref(''),
      fileInfo: ref({
        kind: 'directory',
        name: 'Remote',
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

    vi.mocked(useFilePropertiesActions).mockReturnValue({
      directoryPrimaryActions: ref([
        { id: 'paste', title: 'Paste', icon: 'i-paste', onClick: vi.fn() },
      ]),
      directorySecondaryActions: ref([
        { id: 'createContentItem', label: 'Create content item', icon: 'i-item', onClick: vi.fn() },
        { id: 'createSubgroup', label: 'Create subgroup', icon: 'i-group', onClick: vi.fn() },
      ]),
      filePrimaryActions: ref([]),
      fileSecondaryActions: ref([]),
    });

    vi.mocked(useFilePropertiesBasics).mockReturnValue({
      generalInfoTitle: 'Project',
      isHidden: ref(false),
      mediaMeta: ref({}),
      selectedPath: ref('/projects/proj-1'),
      isBloggerDogProject: ref(false),
      isBloggerDogGroup: ref(false),
      isBloggerDogContentItem: ref(false),
      isBloggerDogMedia: ref(false),
      bloggerDogDeepLink: ref(null),
    });

    const virtualAll = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: {
          kind: 'directory',
          name: 'All Content',
          path: '/virtual-all',
          source: 'remote',
          remoteId: 'virtual-all',
        } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    expect(virtualAll.find('button[title="Paste"]').exists()).toBe(true);
    expect(virtualAll.text()).toContain('Create content item');
    expect(virtualAll.text()).not.toContain('Create subgroup');

    const personal = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: {
          kind: 'directory',
          name: 'Personal',
          path: '/personal',
          source: 'remote',
          remoteId: 'personal',
        } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    expect(personal.find('button[title="Paste"]').exists()).toBe(true);
    expect(personal.text()).not.toContain('Create content item');

    vi.mocked(useFilePropertiesBasics).mockReturnValue({
      generalInfoTitle: 'Project',
      isHidden: ref(false),
      mediaMeta: ref({}),
      selectedPath: ref('/projects/proj-1'),
      isBloggerDogProject: ref(true),
      isBloggerDogGroup: ref(false),
      isBloggerDogContentItem: ref(false),
      isBloggerDogMedia: ref(false),
      bloggerDogDeepLink: ref(null),
    });

    const project = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: {
          kind: 'directory',
          name: 'Project',
          path: '/projects/proj-1',
          source: 'remote',
          remoteId: 'proj-1',
        } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    expect(project.find('button[title="Paste"]').exists()).toBe(true);
    expect(project.text()).toContain('Create content item');
    expect(project.text()).toContain('fastcat.bloggerDog.actions.createGroup');
  });

  it('does not render text editor in BloggerDog content item properties', async () => {
    const { useEntryPreview } = await import('~/composables/file-manager/useEntryPreview');
    const { useFilePropertiesBasics } =
      await import('~/composables/properties/useFilePropertiesBasics');

    vi.mocked(useEntryPreview).mockReturnValue({
      currentUrl: ref(null),
      mediaType: ref(null),
      textContent: ref(''),
      fileInfo: ref({
        kind: 'directory',
        name: 'Sunset',
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

    vi.mocked(useFilePropertiesBasics).mockReturnValue({
      generalInfoTitle: 'Content Item',
      isHidden: ref(false),
      mediaMeta: ref({}),
      selectedPath: ref('/personal/item-1'),
      isBloggerDogProject: ref(false),
      isBloggerDogGroup: ref(false),
      isBloggerDogContentItem: ref(true),
      isBloggerDogMedia: ref(false),
      bloggerDogDeepLink: ref(null),
    });

    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: {
          kind: 'directory',
          name: 'Sunset',
          path: '/personal/item-1',
          source: 'remote',
          adapterPayload: {
            type: 'content-item',
            remoteData: {
              id: 'item-1',
              type: 'file',
              title: 'Sunset',
              path: '/personal/item-1',
              text: 'Hello',
            },
          },
        } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    expect(component.text()).toContain('Hello');
    expect(component.html()).not.toContain('data-testid="text-editor-stub"');
  });

  it('renders text editor preview for BloggerDog virtual txt file', async () => {
    const { useEntryPreview } = await import('~/composables/file-manager/useEntryPreview');
    const { useFilePropertiesBasics } =
      await import('~/composables/properties/useFilePropertiesBasics');
    const { useFilePropertiesActions } =
      await import('~/composables/properties/useFilePropertiesActions');

    vi.mocked(useEntryPreview).mockReturnValue({
      currentUrl: ref(null),
      mediaType: ref('text'),
      textContent: ref('Body text'),
      fileInfo: ref({
        kind: 'file',
        name: 'Sunset.txt',
        lastModified: Date.now(),
      } as any),
      exifData: ref(null),
      exifYaml: ref(null),
      imageDimensions: ref(null),
      timelineDocSummary: ref(null),
      lineCount: ref(1),
      metadataYaml: ref(null),
      isUnknown: ref(false),
      isOtio: ref(false),
      thumbnailUrl: ref(null),
    } as any);

    vi.mocked(useFilePropertiesBasics).mockReturnValue({
      generalInfoTitle: 'text/plain',
      isHidden: ref(false),
      mediaMeta: ref({}),
      selectedPath: ref('/personal/item-1/Sunset.txt'),
      isBloggerDogProject: ref(false),
      isBloggerDogGroup: ref(false),
      isBloggerDogContentItem: ref(false),
      isBloggerDogMedia: ref(true),
      bloggerDogDeepLink: ref(null),
    });

    vi.mocked(useFilePropertiesActions).mockReturnValue({
      directoryPrimaryActions: ref([]),
      directorySecondaryActions: ref([]),
      filePrimaryActions: ref([]),
      fileSecondaryActions: ref([
        { id: 'openAsPanelCut', label: 'Open in cut', icon: 'i-cut', onClick: vi.fn() },
        { id: 'openAsProjectTab', label: 'Open as tab', icon: 'i-tab', onClick: vi.fn() },
      ]),
    });

    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: {
          kind: 'file',
          name: 'Sunset.txt',
          path: '/personal/item-1/Sunset.txt',
          source: 'remote',
          adapterPayload: {
            type: 'media',
            remoteData: {
              id: 'item-1',
              type: 'file',
              title: 'Sunset',
              path: '/personal/item-1',
              text: 'Body text',
            },
          },
        } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    expect(component.get('[data-testid="text-editor-stub"]').text()).toContain(
      'Sunset.txt|/personal/item-1/Sunset.txt',
    );
    expect(component.text()).toContain('Open in cut');
    expect(component.text()).toContain('Open as tab');
  });
});
