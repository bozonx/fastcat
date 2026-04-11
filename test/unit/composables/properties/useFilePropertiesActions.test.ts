import { computed, ref } from 'vue';
import { describe, expect, it } from 'vitest';

import { useFilePropertiesActions } from '~/composables/properties/useFilePropertiesActions';

function createOptions() {
  return {
    t: ((key: string, fallback?: string) => fallback ?? key) as any,
    isProjectRootDir: ref(false),
    isRemoteRoot: ref(false),
    isRemoteMode: ref(false),
    isRemoteAvailable: ref(true),
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
    hasClipboardItems: ref(true),
    triggerDirectoryUpload: () => {},
    createSubfolder: () => {},
    createTimelineInFolder: () => {},
    createMarkdownInFolder: () => {},
    generateProxiesForSelectedFolder: () => {},
    stopProxyGenerationForSelectedFolder: () => {},
    onRename: () => {},
    onDelete: () => {},
    onConvert: () => {},
    openTranscriptionModal: () => {},
    openAsPanelCut: () => {},
    openAsPanelSound: () => {},
    openAsProjectTab: () => {},
    createProxy: () => {},
    cancelProxy: () => {},
    deleteProxy: () => {},
    createOtioVersion: () => {},
    extractAudio: () => {},
    createSubgroup: () => {},
    createContentItem: () => {},
    onCopy: () => {},
    onCut: () => {},
    onPaste: () => {},
    isBloggerDogProject: ref(false),
    isBloggerDogGroup: ref(false),
    isBloggerDogContentItem: ref(false),
    isVirtualAll: ref(false),
    isPersonalLibrary: ref(false),
    instanceId: computed(() => undefined),
    isExternal: ref(false),
  };
}

describe('useFilePropertiesActions', () => {
  it('hides upload and createTimeline for BloggerDog directories', () => {
    const options = createOptions();
    options.isRemoteMode.value = true;
    options.isBloggerDogGroup.value = true;

    const { directorySecondaryActions } = useFilePropertiesActions(options);

    const uploadAction = directorySecondaryActions.value.find((action) => action.id === 'upload');
    const timelineAction = directorySecondaryActions.value.find(
      (action) => action.id === 'createTimeline',
    );

    expect(uploadAction?.hidden).toBe(true);
    expect(timelineAction?.hidden).toBe(true);
  });

  it('keeps BloggerDog-specific actions for personal library', () => {
    const options = createOptions();
    options.isRemoteMode.value = true;
    options.isPersonalLibrary.value = true;

    const { directoryPrimaryActions, directorySecondaryActions } = useFilePropertiesActions(options);

    expect(directoryPrimaryActions.value.find((action) => action.id === 'paste')?.hidden).toBe(
      false,
    );
    expect(
      directorySecondaryActions.value.find((action) => action.id === 'createSubgroup')?.hidden,
    ).toBe(false);
    expect(
      directorySecondaryActions.value.find((action) => action.id === 'createContentItem')?.hidden,
    ).toBe(false);
  });

  it('shows paste for a regular local directory when clipboard has file manager items', () => {
    const options = createOptions();

    const { directoryPrimaryActions } = useFilePropertiesActions(options);

    expect(directoryPrimaryActions.value.find((action) => action.id === 'paste')?.hidden).toBe(
      false,
    );
    expect(directoryPrimaryActions.value.find((action) => action.id === 'paste')?.disabled).toBe(
      false,
    );
  });

  it('hides paste for remote root directories', () => {
    const options = createOptions();
    options.isRemoteMode.value = true;
    options.isRemoteRoot.value = true;

    const { directoryPrimaryActions } = useFilePropertiesActions(options);

    expect(directoryPrimaryActions.value.find((action) => action.id === 'paste')?.hidden).toBe(
      true,
    );
  });
});
