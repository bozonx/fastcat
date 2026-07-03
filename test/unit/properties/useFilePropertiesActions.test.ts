import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useFilePropertiesActions } from '~/composables/properties/useFilePropertiesActions';

function createActions(overrides: Partial<Parameters<typeof useFilePropertiesActions>[0]> = {}) {
  return useFilePropertiesActions({
    t: ((key: string) => key) as Parameters<typeof useFilePropertiesActions>[0]['t'],
    isProjectRootDir: ref(false),
    isRemoteRoot: ref(false),
    isRemoteMode: ref(false),
    isRemoteAvailable: ref(false),
    isFolderWithVideo: ref(false),
    isGeneratingProxyForFolder: ref(false),
    canConvertFile: ref(false),
    canTranscribeMedia: ref(false),
    isAudioFile: ref(false),
    canOpenAsPanel: ref(false),
    canOpenAsProjectTab: ref(false),
    showVideoProxyActions: ref(false),
    hasExistingProxyForFile: ref(false),
    isGeneratingProxyForFile: ref(false),
    isOtio: ref(false),
    isVideoFile: ref(false),
    isVideoWithAudio: ref(false),
    isCommonDir: ref(false),
    isCommonPath: ref(false),
    canCopyOrCut: ref(true),
    hasClipboardItems: ref(false),
    triggerDirectoryUpload: vi.fn(),
    createSubfolder: vi.fn(),
    createTimelineInFolder: vi.fn(),
    createMarkdownInFolder: vi.fn(),
    generateProxiesForSelectedFolder: vi.fn(),
    stopProxyGenerationForSelectedFolder: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onDownload: vi.fn(),
    onConvert: vi.fn(),
    openTranscriptionModal: vi.fn(),
    openAsPanelCut: vi.fn(),
    openAsPanelSound: vi.fn(),
    openAsProjectTab: vi.fn(),
    createProxy: vi.fn(),
    cancelProxy: vi.fn(),
    deleteProxy: vi.fn(),
    createOtioVersion: vi.fn(),
    extractAudio: vi.fn(),
    createSubgroup: vi.fn(),
    createContentItem: vi.fn(),
    onCopy: vi.fn(),
    onCut: vi.fn(),
    onPaste: vi.fn(),
    isBloggerDogProject: ref(false),
    ...overrides,
  });
}

describe('useFilePropertiesActions', () => {
  it('puts download first in file secondary actions and wires its click handler', () => {
    const onDownload = vi.fn();
    const { fileSecondaryActions } = createActions({ onDownload });

    expect(fileSecondaryActions.value[0]).toMatchObject({
      id: 'download',
      label: 'videoEditor.fileManager.actions.downloadFile',
      icon: 'i-heroicons-arrow-down-tray',
    });

    fileSecondaryActions.value[0]?.onClick();

    expect(onDownload).toHaveBeenCalledOnce();
  });

  it('hides download for external file properties', () => {
    const { fileSecondaryActions } = createActions({ isExternal: ref(true) });

    expect(fileSecondaryActions.value[0]?.id).toBe('download');
    expect(fileSecondaryActions.value[0]?.hidden).toBe(true);
  });
});
