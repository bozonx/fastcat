import { computed, type Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import type {
  PrimaryEntryAction,
  SecondaryEntryAction,
} from '~/composables/properties/useFilePropertiesActions';
import { isBloggerDogTextWrapper } from '~/utils/bloggerdog-file-manager';

export interface FilePropertiesActionGroupsDeps {
  directoryPrimaryActions: Ref<PrimaryEntryAction[]>;
  directorySecondaryActions: Ref<SecondaryEntryAction[]>;
  filePrimaryActions: Ref<PrimaryEntryAction[]>;
  fileSecondaryActions: Ref<SecondaryEntryAction[]>;
  isPersonalLibrary: Ref<boolean>;
  isRemoteContent: Ref<boolean>;
  isRemoteFileEntry: Ref<boolean>;
  isExternalContext: Ref<boolean>;
  hasClipboardItems: Ref<boolean>;
  selectedFsEntry: () => FsEntry;
  onPaste: () => void;
  createSubfolder: () => void;
  createMarkdownInFolder: () => void;
  t: (key: string, ...args: unknown[]) => string;
}

/**
 * Derives the various filtered/contextual action lists rendered by
 * `FileProperties.vue` (regular directory/file, BloggerDog virtual roots,
 * personal library, project, workspace root). Pure filtering of the action
 * lists produced by {@link useFilePropertiesActions}; extracted to slim the
 * component script.
 */
export function useFilePropertiesActionGroups(deps: FilePropertiesActionGroupsDeps) {
  const filteredDirectoryPrimaryActions = computed(() => {
    if (deps.isPersonalLibrary.value) return [];

    if (!deps.isRemoteContent.value) {
      return deps.directoryPrimaryActions.value.filter(
        (a: PrimaryEntryAction) => !['createSubgroup', 'createContentItem'].includes(a.id),
      );
    }

    return deps.directoryPrimaryActions.value;
  });

  const filteredFilePrimaryActions = computed(() => {
    if (isBloggerDogTextWrapper(deps.selectedFsEntry())) {
      return deps.filePrimaryActions.value.filter((action) => action.id === 'copy');
    }

    return deps.filePrimaryActions.value;
  });

  const filteredFileSecondaryActions = computed<SecondaryEntryAction[]>(() => {
    if (deps.isRemoteFileEntry.value) return [];

    if (!deps.isExternalContext.value) return deps.fileSecondaryActions.value;

    return deps.fileSecondaryActions.value.filter(
      (action) =>
        action.id !== 'openAsPanelCut' &&
        action.id !== 'openAsPanelSound' &&
        action.id !== 'openAsProjectTab',
    );
  });

  const virtualAllPrimaryActions = computed<PrimaryEntryAction[]>(() =>
    deps.directoryPrimaryActions.value.filter((action) => action.id === 'paste'),
  );

  const virtualAllSecondaryActions = computed<SecondaryEntryAction[]>(() =>
    deps.directorySecondaryActions.value.filter((action) => action.id === 'createContentItem'),
  );

  const personalLibraryPrimaryActions = computed<PrimaryEntryAction[]>(() =>
    deps.directoryPrimaryActions.value.filter((action) => action.id === 'paste'),
  );

  const personalLibrarySecondaryActions = computed<SecondaryEntryAction[]>(() =>
    deps.directorySecondaryActions.value.filter(
      (action) => action.id === 'createSubgroup' || action.id === 'createContentItem',
    ),
  );

  const projectPrimaryActions = computed<PrimaryEntryAction[]>(() =>
    deps.directoryPrimaryActions.value.filter((action) => action.id === 'paste'),
  );

  const projectSecondaryActions = computed<SecondaryEntryAction[]>(() =>
    deps.directorySecondaryActions.value.filter(
      (action) => action.id === 'createContentItem' || action.id === 'createSubgroup',
    ),
  );

  const workspaceRootPrimaryActions = computed<PrimaryEntryAction[]>(() => [
    {
      id: 'paste',
      title: deps.t('common.paste'),
      icon: 'i-heroicons-clipboard',
      disabled: !deps.hasClipboardItems.value,
      onClick: deps.onPaste,
    },
  ]);

  const workspaceRootSecondaryActions = computed<SecondaryEntryAction[]>(() => [
    {
      id: 'createSubfolder',
      label: deps.t('videoEditor.fileManager.actions.createFolder'),
      icon: 'i-heroicons-folder-plus',
      onClick: deps.createSubfolder,
    },
    {
      id: 'createMarkdown',
      label: deps.t('videoEditor.fileManager.actions.createMarkdown'),
      icon: 'i-heroicons-document-text',
      onClick: deps.createMarkdownInFolder,
    },
  ]);

  return {
    filteredDirectoryPrimaryActions,
    filteredFilePrimaryActions,
    filteredFileSecondaryActions,
    virtualAllPrimaryActions,
    virtualAllSecondaryActions,
    personalLibraryPrimaryActions,
    personalLibrarySecondaryActions,
    projectPrimaryActions,
    projectSecondaryActions,
    workspaceRootPrimaryActions,
    workspaceRootSecondaryActions,
  };
}
