import { ref } from 'vue';
import type { Ref } from 'vue';
import { useBloggerDogStore } from '~/stores/bloggerdog';
import { useUiStore } from '~/stores/ui.store';
import { getBdPayload, type BdEntryType } from '~/types/bloggerdog';
import type { FsEntry } from '~/types/fs';
import type { RemoteFsEntry } from '~/utils/remote-vfs';
import type { RemoteVfsScope } from '~/types/remote-vfs';

interface UseFileBrowserRemoteCreateParams {
  vfs: {
    createDirectory: (path: string) => Promise<void>;
  };
  bloggerDogStore?: {
    createItem: (params: {
      title: string;
      scope: RemoteVfsScope;
      projectId?: string;
      groupId?: string;
    }) => Promise<unknown>;
  };
  buildRemoteDirectoryEntry: (path: string, type?: BdEntryType) => RemoteFsEntry;
  remoteCurrentFolder: Ref<RemoteFsEntry | null>;
  loadFolderContent: () => Promise<void>;
  loadParentFolders: () => Promise<void>;
  notifyFileManagerUpdate?: () => void;
  clearPendingCreateSubgroup?: () => void;
  clearPendingCreateItem?: () => void;
  t?: (key: string) => string;
  toast?: {
    add: (params: { color: string; title: string; description: string }) => void;
  };
}

export function useFileBrowserRemoteCreate(params: UseFileBrowserRemoteCreateParams) {
  const isSubgroupModalOpen = ref(false);
  const pendingSubgroupParent = ref<FsEntry | null>(null);
  const isItemModalOpen = ref(false);
  const pendingItemParent = ref<FsEntry | null>(null);

  const bloggerDogStore = params.bloggerDogStore || useBloggerDogStore();
  const uiStore = useUiStore();
  const { t } = useI18n();
  const toast = useToast();

  const resolveT = params.t || t;
  const resolveToast = params.toast || toast;
  const notifyUpdate = params.notifyFileManagerUpdate || (() => uiStore.notifyFileManagerUpdate());

  const clearSubgroup = params.clearPendingCreateSubgroup || (() => {
    uiStore.pendingBloggerDogCreateSubgroup = null;
  });

  const clearItem = params.clearPendingCreateItem || (() => {
    uiStore.pendingBloggerDogCreateItem = null;
  });

  function handlePendingBloggerDogCreateSubgroup(entry: FsEntry) {
    pendingSubgroupParent.value = entry;
    isSubgroupModalOpen.value = true;
    clearSubgroup();
  }

  async function onSubgroupCreateConfirm(name: string) {
    const parent = pendingSubgroupParent.value;
    if (!parent) return;

    try {
      const newPath = `${parent.path}/${name}`;
      await params.vfs.createDirectory(newPath);

      params.remoteCurrentFolder.value = params.buildRemoteDirectoryEntry(newPath, 'collection');
      await params.loadFolderContent();
      await params.loadParentFolders();
      notifyUpdate();
    } catch (error) {
      resolveToast.add({
        color: 'error',
        title: resolveT('common.error'),
        description: error instanceof Error ? error.message : 'Failed to create subgroup',
      });
    } finally {
      isSubgroupModalOpen.value = false;
      pendingSubgroupParent.value = null;
    }
  }

  function handlePendingBloggerDogCreateItem(entry: FsEntry) {
    pendingItemParent.value = entry;
    isItemModalOpen.value = true;
    clearItem();
  }

  async function onItemCreateConfirm(name: string) {
    const parent = pendingItemParent.value;
    if (!parent) return;

    try {
      const parentPayload = getBdPayload(parent);
      const remoteData = parentPayload?.remoteData;
      const parentPath = parent.path || '/';

      let scope: RemoteVfsScope = 'personal';
      let projectId: string | undefined;
      let groupId: string | undefined;

      if (parentPayload?.type === 'virtual-folder') {
        const isPersonal =
          parent.remoteId === 'personal' ||
          parent.remoteId === 'virtual-all' ||
          parentPath.endsWith('/personal') ||
          parentPath.endsWith('/virtual-all');
        scope = isPersonal ? 'personal' : 'project';
      } else if (parentPayload?.type === 'project') {
        scope = 'project';
        projectId = remoteData?.id;
      } else if (parentPayload?.type === 'collection') {
        scope = (remoteData as { scope?: RemoteVfsScope } | undefined)?.scope || 'personal';
        projectId = (remoteData as { projectId?: string } | undefined)?.projectId;
        groupId = remoteData?.id;
      } else if (parentPayload?.type === 'content-item') {
        const itemRemoteData = remoteData as
          | {
              scope?: RemoteVfsScope;
              projectId?: string;
              groupId?: string;
              collectionId?: string;
            }
          | undefined;
        scope = itemRemoteData?.scope || 'personal';
        projectId = itemRemoteData?.projectId;
        groupId = itemRemoteData?.groupId || itemRemoteData?.collectionId;
      }

      await bloggerDogStore.createItem({
        title: name,
        scope,
        projectId,
        groupId,
      });

      const newPath = `${parentPath === '/' ? '' : parentPath}/${name}`;
      params.remoteCurrentFolder.value = params.buildRemoteDirectoryEntry(newPath, 'content-item');

      await params.loadFolderContent();
      await params.loadParentFolders();
      notifyUpdate();
    } catch (error) {
      resolveToast.add({
        color: 'error',
        title: resolveT('common.error'),
        description: error instanceof Error ? error.message : 'Failed to create item',
      });
    } finally {
      isItemModalOpen.value = false;
      pendingItemParent.value = null;
    }
  }

  return {
    isSubgroupModalOpen,
    isItemModalOpen,
    handlePendingBloggerDogCreateSubgroup,
    handlePendingBloggerDogCreateItem,
    onSubgroupCreateConfirm,
    onItemCreateConfirm,
  };
}
