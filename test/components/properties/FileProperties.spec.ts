import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { mountWithNuxt } from '../../utils/mount';
import FileProperties from '~/components/properties/FileProperties.vue';

// Mock all internal composables used by FileProperties.vue
vi.mock('~/composables/fileManager/useEntryPreview', () => ({
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
    directoryPrimaryActions: [],
    directorySecondaryActions: [],
    filePrimaryActions: [{ label: 'Mock Action', onClick: vi.fn() }],
    fileSecondaryActions: [],
  })),
}));

vi.mock('~/composables/fileManager/useFileManager', () => ({
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

describe('FileProperties.vue', () => {
  it('renders properties for a video file', async () => {
    const component = await mountWithNuxt(FileProperties, {
      props: {
        selectedFsEntry: { kind: 'file', name: 'test.mp4', path: '/projects/test.mp4' } as any,
        previewMode: 'original',
        hasProxy: false,
      },
    });

    // Expect EntryPreviewBox
    expect(component.findComponent({ name: 'EntryPreviewBox' }).exists()).toBe(true);

    // Expect Actions Section
    expect(component.text()).toContain('Actions');
    expect(component.text()).toContain('Mock Action');

    // Expect Meta Section
    expect(component.text()).toContain('Meta');
  });

  it('renders properties for a directory', async () => {
    // Override useEntryPreview for directory
    const { useEntryPreview } = await import('~/composables/fileManager/useEntryPreview');
    (useEntryPreview as any).mockReturnValue({
      currentUrl: ref(null),
      mediaType: ref(null),
      textContent: ref(''),
      fileInfo: ref({
        kind: 'directory',
        name: 'test_folder',
        lastModified: Date.now(),
      }),
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
        selectedFsEntry: { kind: 'directory', name: 'test_folder', path: '/projects/test_folder' } as any,
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
    const { useEntryPreview } = await import('~/composables/fileManager/useEntryPreview');
    
    (useFileStorageInfo as any).mockReturnValue({
      isProjectRootDir: ref(true),
      storageFreeBytes: ref(1024 * 1024 * 1024 * 50),
      projectStats: ref({
        fileCount: 42,
        totalSizeBytes: 1024 * 1024 * 1024 * 5,
      }),
    });

    (useEntryPreview as any).mockReturnValue({
      currentUrl: ref(null),
      mediaType: ref(null),
      textContent: ref(''),
      fileInfo: ref({
        kind: 'directory',
        name: 'Project Root',
        lastModified: Date.now(),
      }),
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

    // Project root section should be visible
    expect(component.findComponent({ name: 'FileProjectRootSection' }).exists()).toBe(true);
    expect(component.text()).toContain('42'); // file count
  });
});
