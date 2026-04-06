import { computed, type Ref } from 'vue';

interface EntryAction {
  id: string;
  icon: string;
  hidden?: boolean;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
}

interface PrimaryEntryAction extends EntryAction {
  title: string;
}

interface SecondaryEntryAction extends EntryAction {
  label: string;
  color?: string;
}

interface UseFilePropertiesActionsOptions {
  t: ReturnType<typeof useI18n>['t'];
  isProjectRootDir: Ref<boolean>;
  isRemoteRoot: Ref<boolean>;
  isRemoteMode: Ref<boolean>;
  isRemoteAvailable: Ref<boolean>;
  isFolderWithVideo: Ref<boolean>;
  isGeneratingProxyForFolder: Ref<boolean>;
  canConvertFile: Ref<boolean>;
  canUploadToRemote: Ref<boolean>;
  canTranscribeMedia: Ref<boolean>;
  isAudioFile: Ref<boolean>;
  canOpenAsPanel: Ref<boolean>;
  canOpenAsProjectTab: Ref<boolean>;
  showVideoProxyActions: Ref<boolean>;
  hasExistingProxyForFile: Ref<boolean>;
  isGeneratingProxyForFile: Ref<boolean>;
  isOtio: Ref<boolean>;
  isVideoFile: Ref<boolean>;
  isCommonDir: Ref<boolean>;
  isCommonPath: Ref<boolean>;
  canCopyOrCut: Ref<boolean>;
  hasClipboardItems: Ref<boolean>;
  triggerDirectoryUpload: () => void;
  createSubfolder: () => void;
  createTimelineInFolder: () => void;
  createMarkdownInFolder: () => void;
  generateProxiesForSelectedFolder: () => void | Promise<void>;
  stopProxyGenerationForSelectedFolder: () => void | Promise<void>;
  onRename: () => void;
  onDelete: () => void;
  onConvert: () => void;
  openRemoteUploadPicker: () => void;
  openTranscriptionModal: () => void;
  openAsPanelCut: () => void;
  openAsPanelSound: () => void;
  openAsProjectTab: () => void;
  createProxy: () => void | Promise<void>;
  cancelProxy: () => void;
  deleteProxy: () => void;
  createOtioVersion: () => void;
  extractAudio: () => void;
  createSubgroup: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
}

export function useFilePropertiesActions(options: UseFilePropertiesActionsOptions) {
  const directoryPrimaryActions = computed<PrimaryEntryAction[]>(() => [
    {
      id: 'delete',
      title: options.t('common.delete'),
      icon: 'i-heroicons-trash',
      hidden: options.isProjectRootDir.value || options.isCommonDir.value || options.isRemoteRoot.value,
      onClick: options.onDelete,
    },
    {
      id: 'rename',
      title: options.t('common.rename'),
      icon: 'i-heroicons-pencil',
      hidden: options.isProjectRootDir.value || options.isCommonDir.value || options.isRemoteRoot.value,
      onClick: options.onRename,
    },
    {
      id: 'copy',
      title: options.t('common.copy'),
      icon: 'i-heroicons-document-duplicate',
      hidden: !options.canCopyOrCut.value,
      onClick: options.onCopy,
    },
    {
      id: 'cut',
      title: options.t('common.cut'),
      icon: 'i-heroicons-scissors',
      hidden: !options.canCopyOrCut.value,
      onClick: options.onCut,
    },
    {
      id: 'paste',
      title: options.t('common.paste'),
      icon: 'i-heroicons-clipboard',
      disabled: !options.hasClipboardItems.value,
      onClick: options.onPaste,
    },
    {
      id: 'createSubgroup',
      title: options.t('videoEditor.fileManager.actions.createFolder'),
      icon: 'i-heroicons-folder-plus',
      hidden: !options.isRemoteAvailable?.value && !options.isRemoteMode?.value, // Only for remote
      onClick: options.createSubgroup,
    },
  ]);

  const directorySecondaryActions = computed<SecondaryEntryAction[]>(() => [
    {
      id: 'upload',
      label: options.t('videoEditor.fileManager.actions.uploadFiles'),
      icon: 'i-heroicons-arrow-up-tray',
      onClick: options.triggerDirectoryUpload,
    },
    {
      id: 'createSubfolder',
      label: options.t('videoEditor.fileManager.actions.createFolder'),
      icon: 'i-heroicons-folder-plus',
      onClick: options.createSubfolder,
    },
    {
      id: 'createTimeline',
      label: options.t('videoEditor.fileManager.actions.createTimeline'),
      icon: 'i-heroicons-document-plus',
      onClick: options.createTimelineInFolder,
    },
    {
      id: 'createMarkdown',
      label: options.t('videoEditor.fileManager.actions.createMarkdown'),
      icon: 'i-heroicons-document-text',
      onClick: options.createMarkdownInFolder,
    },
    {
      id: 'createProxyForAll',
      label: options.t('videoEditor.fileManager.actions.createProxyForAll'),
      icon: 'i-heroicons-film',
      hidden: !options.isFolderWithVideo.value || options.isGeneratingProxyForFolder.value,
      onClick: options.generateProxiesForSelectedFolder,
    },
    {
      id: 'cancelProxyForAll',
      label: options.t('videoEditor.fileManager.actions.cancelProxyGeneration'),
      icon: 'i-heroicons-x-circle',
      color: 'error',
      hidden: !options.isFolderWithVideo.value || !options.isGeneratingProxyForFolder.value,
      onClick: options.stopProxyGenerationForSelectedFolder,
    },
  ]);

  const filePrimaryActions = computed<PrimaryEntryAction[]>(() => [
    {
      id: 'delete',
      title: options.t('common.delete'),
      icon: 'i-heroicons-trash',
      hidden: false,
      onClick: options.onDelete,
    },
    {
      id: 'rename',
      title: options.t('common.rename'),
      icon: 'i-heroicons-pencil',
      hidden: false, // Root project or common root are already checked by isCommonDir for folders
      onClick: options.onRename,
    },
    {
      id: 'copy',
      title: options.t('common.copy'),
      icon: 'i-heroicons-document-duplicate',
      hidden: !options.canCopyOrCut.value,
      onClick: options.onCopy,
    },
    {
      id: 'cut',
      title: options.t('common.cut'),
      icon: 'i-heroicons-scissors',
      hidden: !options.canCopyOrCut.value,
      onClick: options.onCut,
    },
    {
      id: 'uploadRemote',
      title: options.t('videoEditor.fileManager.actions.uploadRemote'),
      icon: 'i-heroicons-cloud-arrow-up',
      hidden: !options.canUploadToRemote.value,
      onClick: options.openRemoteUploadPicker,
    },
  ]);

  const fileSecondaryActions = computed<SecondaryEntryAction[]>(() => [
    {
      id: 'convertFile',
      label: options.t('videoEditor.fileManager.actions.convertFile'),
      icon: 'i-heroicons-arrow-path',
      hidden: !options.canConvertFile.value,
      onClick: options.onConvert,
    },
    {
      id: 'transcribe',
      label: options.t('videoEditor.fileManager.actions.transcribe'),
      icon: 'i-heroicons-microphone',
      hidden: !options.isVideoFile.value && !options.isAudioFile.value,
      disabled: !options.canTranscribeMedia.value,
      onClick: options.openTranscriptionModal,
    },
    {
      id: 'openAsPanelCut',
      label: options.t('videoEditor.fileManager.actions.openAsPanelCut'),
      icon: 'i-heroicons-window',
      hidden: !options.canOpenAsPanel.value,
      onClick: options.openAsPanelCut,
    },
    {
      id: 'openAsPanelSound',
      label: options.t('videoEditor.fileManager.actions.openAsPanelSound'),
      icon: 'i-heroicons-window',
      hidden: !options.canOpenAsPanel.value,
      onClick: options.openAsPanelSound,
    },
    {
      id: 'openAsProjectTab',
      label: options.t('videoEditor.fileManager.actions.openAsProjectTab'),
      icon: 'i-heroicons-squares-plus',
      hidden: !options.canOpenAsProjectTab.value,
      onClick: options.openAsProjectTab,
    },
    {
      id: 'createProxy',
      label: options.hasExistingProxyForFile.value
        ? options.t('videoEditor.fileManager.proxy.regenerate')
        : options.t('videoEditor.fileManager.proxy.create'),
      icon: options.hasExistingProxyForFile.value ? 'i-heroicons-arrow-path' : 'i-heroicons-film',
      hidden: !options.showVideoProxyActions.value || options.isGeneratingProxyForFile.value,
      onClick: options.createProxy,
    },
    {
      id: 'cancelProxy',
      label: options.t('videoEditor.fileManager.actions.cancelProxyGeneration'),
      icon: 'i-heroicons-x-circle',
      color: 'error',
      hidden: !options.showVideoProxyActions.value || !options.isGeneratingProxyForFile.value,
      onClick: options.cancelProxy,
    },
    {
      id: 'deleteProxy',
      label: options.t('videoEditor.fileManager.proxy.delete'),
      icon: 'i-heroicons-trash',
      color: 'error',
      hidden: !options.showVideoProxyActions.value || !options.hasExistingProxyForFile.value,
      onClick: options.deleteProxy,
    },
    {
      id: 'createOtioVersion',
      label: options.t('fastcat.timeline.createVersion'),
      icon: 'i-heroicons-document-duplicate',
      hidden: !options.isOtio.value,
      onClick: options.createOtioVersion,
    },
    {
      id: 'extractAudio',
      label: options.t('videoEditor.fileManager.actions.extractAudio'),
      icon: 'i-heroicons-musical-note',
      hidden: !options.isVideoFile.value,
      onClick: options.extractAudio,
    },
  ]);

  return {
    directoryPrimaryActions,
    directorySecondaryActions,
    filePrimaryActions,
    fileSecondaryActions,
  };
}
