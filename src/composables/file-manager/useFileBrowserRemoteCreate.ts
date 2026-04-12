import { ref } from 'vue';
import type { Ref } from 'vue';
import { getBdPayload, type BdEntryType } from '~/types/bloggerdog';
import type { FsEntry } from '~/types/fs';
import type { RemoteFsEntry } from '~/utils/remote-vfs';
import type { RemoteVfsScope } from '~/types/remote-vfs';

interface UseFileBrowserRemoteCreateParams {
  vfs: {
    createDirectory: (path: string) => Promise<void>;
  };
  bloggerDogStore: {
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
  notifyFileManagerUpdate: () => void;
  clearPendingCreateSubgroup: () => void;
  clearPendingCreateItem: () => void;
  t: (key: string) => string;
  toast: {
    add: (params: { color: string; title: string; description: string }) => void;
  };
}

export function useFileBrowserRemoteCreate(params: UseFileBrowserRemoteCreateParams) {
  const isSubgroupModalOpen = ref(false);
  const pendingSubgroupParent = ref<FsEntry | null>(null);
  const isItemModalOpen = ref(false);
  const pendingItemParent = ref<FsEntry | null>(null);

  function handlePendingBloggerDogCreateSubgroup(entry: FsEntry) {
    pendingSubgroupParent.value = entry;
    isSubgroupModalOpen.value = true;
    params.clearPendingCreateSubgroup();
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
      params.notifyFileManagerUpdate();
    } catch (error) {
      params.toast.add({
        color: 'error',
        title: params.t('common.error'),
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
    params.clearPendingCreateItem();
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
        const isPersonal = parent.remoteId === 'personal' || parentPath.endsWith('/personal');
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

      await params.bloggerDogStore.createItem({
        title: name,
        scope,
        projectId,
        groupId,
      });

      const newPath = `${parentPath === '/' ? '' : parentPath}/${name}`;
      params.remoteCurrentFolder.value = params.buildRemoteDirectoryEntry(newPath, 'content-item');

      await params.loadFolderContent();
      await params.loadParentFolders();
      params.notifyFileManagerUpdate();
    } catch (error) {
      params.toast.add({
        color: 'error',
        title: params.t('common.error'),
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
