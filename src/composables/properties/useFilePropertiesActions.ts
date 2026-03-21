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
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
}

export function useFilePropertiesActions(options: UseFilePropertiesActionsOptions) {
  const directoryPrimaryActions = computed<PrimaryEntryAction[]>(() => [
    {
      id: 'copy',
      title: options.t('common.copy', 'Copy'),
      icon: 'i-heroicons-document-duplicate',
      hidden: !options.canCopyOrCut.value,
      onClick: options.onCopy,
    },
    {
      id: 'cut',
      title: options.t('common.cut', 'Cut'),
      icon: 'i-heroicons-scissors',
      hidden: !options.canCopyOrCut.value,
      onClick: options.onCut,
    },
    {
      id: 'rename',
      title: options.t('common.rename', 'Rename'),
      icon: 'i-heroicons-pencil',
      hidden:
        options.isProjectRootDir.value || options.isCommonDir.value || options.isCommonPath.value,
      onClick: options.onRename,
    },
    {
      id: 'delete',
      title: options.t('common.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      hidden:
        options.isProjectRootDir.value || options.isCommonDir.value || options.isCommonPath.value,
      onClick: options.onDelete,
    },
    {
      id: 'upload',
      title: options.t('videoEditor.fileManager.actions.uploadFiles', 'Upload files'),
      icon: 'i-heroicons-arrow-up-tray',
      onClick: options.triggerDirectoryUpload,
    },
    {
      id: 'createSubfolder',
      title: options.t('videoEditor.fileManager.actions.createFolder', 'Create Folder'),
      icon: 'i-heroicons-folder-plus',
      onClick: options.createSubfolder,
    },
    {
      id: 'paste',
      title: options.t('common.paste', 'Paste'),
      icon: 'i-heroicons-clipboard',
      hidden: !options.hasClipboardItems.value,
      onClick: options.onPaste,
    },
  ]);

  const directorySecondaryActions = computed<SecondaryEntryAction[]>(() => [
    {
      id: 'createTimeline',
      label: options.t('videoEditor.fileManager.actions.createTimeline', 'Create Timeline'),
      icon: 'i-heroicons-document-plus',
      onClick: options.createTimelineInFolder,
    },
    {
      id: 'createMarkdown',
      label: options.t(
        'videoEditor.fileManager.actions.createMarkdown',
        'Create Markdown document',
      ),
      icon: 'i-heroicons-document-text',
      onClick: options.createMarkdownInFolder,
    },
    {
      id: 'createProxyForAll',
      label: options.t(
        'videoEditor.fileManager.actions.createProxyForAll',
        'Create proxy for all videos',
      ),
      icon: 'i-heroicons-film',
      hidden: !options.isFolderWithVideo.value || options.isGeneratingProxyForFolder.value,
      onClick: options.generateProxiesForSelectedFolder,
    },
    {
      id: 'cancelProxyForAll',
      label: options.t(
        'videoEditor.fileManager.actions.cancelProxyGeneration',
        'Cancel proxy generation',
      ),
      icon: 'i-heroicons-x-circle',
      color: 'error',
      hidden: !options.isFolderWithVideo.value || !options.isGeneratingProxyForFolder.value,
      onClick: options.stopProxyGenerationForSelectedFolder,
    },
  ]);

  const filePrimaryActions = computed<PrimaryEntryAction[]>(() => [
    {
      id: 'copy',
      title: options.t('common.copy', 'Copy'),
      icon: 'i-heroicons-document-duplicate',
      hidden: !options.canCopyOrCut.value,
      onClick: options.onCopy,
    },
    {
      id: 'cut',
      title: options.t('common.cut', 'Cut'),
      icon: 'i-heroicons-scissors',
      hidden: !options.canCopyOrCut.value,
      onClick: options.onCut,
    },
    {
      id: 'rename',
      title: options.t('common.rename', 'Rename'),
      icon: 'i-heroicons-pencil',
      hidden: options.isCommonPath.value,
      onClick: options.onRename,
    },
    {
      id: 'delete',
      title: options.t('common.delete', 'Delete'),
      icon: 'i-heroicons-trash',
      hidden: options.isCommonPath.value,
      onClick: options.onDelete,
    },
    {
      id: 'uploadRemote',
      title: options.t('videoEditor.fileManager.actions.uploadRemote', 'Upload to remote'),
      icon: 'i-heroicons-cloud-arrow-up',
      hidden: !options.canUploadToRemote.value,
      onClick: options.openRemoteUploadPicker,
    },
  ]);

  const fileSecondaryActions = computed<SecondaryEntryAction[]>(() => [
    {
      id: 'convertFile',
      label: options.t('videoEditor.fileManager.actions.convertFile', 'Convert File'),
      icon: 'i-heroicons-arrow-path',
      hidden: !options.canConvertFile.value,
      onClick: options.onConvert,
    },
    {
      id: 'copy',
      label: options.t('common.copy', 'Copy'),
      icon: 'i-heroicons-document-duplicate',
      hidden: !options.canCopyOrCut.value,
      onClick: options.onCopy,
    },
    {
      id: 'cut',
      label: options.t('common.cut', 'Cut'),
      icon: 'i-heroicons-scissors',
      hidden: !options.canCopyOrCut.value,
      onClick: options.onCut,
    },
    {
      id: 'transcribe',
      label: options.t('videoEditor.fileManager.actions.transcribe', 'Transcribe'),
      icon: 'i-heroicons-microphone',
      hidden: !options.isVideoFile.value && !options.isAudioFile.value,
      disabled: !options.canTranscribeMedia.value,
      onClick: options.openTranscriptionModal,
    },
    {
      id: 'openAsPanelCut',
      label: options.t('videoEditor.fileManager.actions.openAsPanelCut', 'Open as panel (Editor)'),
      icon: 'i-heroicons-window',
      hidden: !options.canOpenAsPanel.value,
      onClick: options.openAsPanelCut,
    },
    {
      id: 'openAsPanelSound',
      label: options.t('videoEditor.fileManager.actions.openAsPanelSound', 'Open as panel (Sound)'),
      icon: 'i-heroicons-window',
      hidden: !options.canOpenAsPanel.value,
      onClick: options.openAsPanelSound,
    },
    {
      id: 'openAsProjectTab',
      label: options.t('videoEditor.fileManager.actions.openAsProjectTab', 'Open as project tab'),
      icon: 'i-heroicons-squares-plus',
      hidden: !options.canOpenAsProjectTab.value,
      onClick: options.openAsProjectTab,
    },
    {
      id: 'createProxy',
      label: options.hasExistingProxyForFile.value
        ? options.t('videoEditor.fileManager.proxy.regenerate', 'Regenerate proxy')
        : options.t('videoEditor.fileManager.proxy.create', 'Create proxy'),
      icon: options.hasExistingProxyForFile.value ? 'i-heroicons-arrow-path' : 'i-heroicons-film',
      hidden: !options.showVideoProxyActions.value || options.isGeneratingProxyForFile.value,
      onClick: options.createProxy,
    },
    {
      id: 'cancelProxy',
      label: options.t(
        'videoEditor.fileManager.actions.cancelProxyGeneration',
        'Cancel proxy generation',
      ),
      icon: 'i-heroicons-x-circle',
      color: 'error',
      hidden: !options.showVideoProxyActions.value || !options.isGeneratingProxyForFile.value,
      onClick: options.cancelProxy,
    },
    {
      id: 'deleteProxy',
      label: options.t('videoEditor.fileManager.proxy.delete', 'Delete proxy'),
      icon: 'i-heroicons-trash',
      color: 'error',
      hidden: !options.showVideoProxyActions.value || !options.hasExistingProxyForFile.value,
      onClick: options.deleteProxy,
    },
    {
      id: 'createOtioVersion',
      label: options.t('fastcat.timeline.createVersion', 'Create version'),
      icon: 'i-heroicons-document-duplicate',
      hidden: !options.isOtio.value,
      onClick: options.createOtioVersion,
    },
    {
      id: 'extractAudio',
      label: options.t('videoEditor.fileManager.actions.extractAudio', 'Extract Audio'),
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
