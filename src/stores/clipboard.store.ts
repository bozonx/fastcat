import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';

import type { FsEntry } from '~/types/fs';
import type { TimelineClipItem } from '~/timeline/types';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

export interface FileManagerClipboardItem {
  path: string;
  kind: FsEntry['kind'];
  name: string;
  source?: FsEntry['source'];
}

export interface TimelineClipboardItem {
  sourceTrackId: string;
  clip: TimelineClipItem;
}

export type ClipboardSource = 'fileManager' | 'timeline';
export type ClipboardOperation = 'copy' | 'cut';

export interface FileManagerClipboardPayload {
  source: 'fileManager';
  operation: ClipboardOperation;
  items: FileManagerClipboardItem[];
  sourceInstanceId?: string;
}

export interface TimelineClipboardPayload {
  source: 'timeline';
  operation: ClipboardOperation;
  items: TimelineClipboardItem[];
}

export type AppClipboardPayload = FileManagerClipboardPayload | TimelineClipboardPayload;

export const useClipboardStore = defineStore('clipboard', () => {
  const clipboardPayload = ref<AppClipboardPayload | null>(null);
  const currentDragOperation = ref<'copy' | 'move' | null>(null);
  const dragSourceFileManagerInstanceId = ref<string | null>(null);
  const dragTargetFileManagerInstanceId = ref<string | null>(null);
  const dragSourceVfs = shallowRef<IFileSystemAdapter | null>(null);
  const fileManagerVfsRegistry = shallowRef<
    Record<string, { count: number; vfs: IFileSystemAdapter }>
  >({});

  const hasFileManagerPayload = computed(
    () =>
      clipboardPayload.value?.source === 'fileManager' && clipboardPayload.value.items.length > 0,
  );

  const hasTimelinePayload = computed(
    () => clipboardPayload.value?.source === 'timeline' && clipboardPayload.value.items.length > 0,
  );

  function setClipboardPayload(payload: AppClipboardPayload | null) {
    clipboardPayload.value = payload;
  }

  function clearClipboardPayload() {
    clipboardPayload.value = null;
  }

  function setCurrentDragOperation(operation: 'copy' | 'move' | null) {
    currentDragOperation.value = operation;
  }

  function setDragSourceFileManagerInstanceId(instanceId: string | null) {
    dragSourceFileManagerInstanceId.value = instanceId;
  }

  function setDragTargetFileManagerInstanceId(instanceId: string | null) {
    dragTargetFileManagerInstanceId.value = instanceId;
  }

  function setDragSourceVfs(vfs: IFileSystemAdapter | null) {
    dragSourceVfs.value = vfs;
  }

  function registerFileManagerVfs(instanceId: string, vfs: IFileSystemAdapter) {
    const current = fileManagerVfsRegistry.value[instanceId];
    fileManagerVfsRegistry.value = {
      ...fileManagerVfsRegistry.value,
      [instanceId]: {
        vfs,
        count: (current?.count ?? 0) + 1,
      },
    };
  }

  function unregisterFileManagerVfs(instanceId: string) {
    const nextRegistry = { ...fileManagerVfsRegistry.value };
    const current = nextRegistry[instanceId];
    if (!current) {
      fileManagerVfsRegistry.value = nextRegistry;
      return;
    }

    if (current.count <= 1) {
      delete nextRegistry[instanceId];
    } else {
      nextRegistry[instanceId] = {
        ...current,
        count: current.count - 1,
      };
    }
    fileManagerVfsRegistry.value = nextRegistry;
  }

  function getFileManagerVfs(instanceId?: string | null) {
    if (!instanceId) return null;
    return fileManagerVfsRegistry.value[instanceId]?.vfs ?? null;
  }

  return {
    clipboardPayload,
    currentDragOperation,
    dragSourceFileManagerInstanceId,
    dragTargetFileManagerInstanceId,
    dragSourceVfs,
    fileManagerVfsRegistry,
    hasFileManagerPayload,
    hasTimelinePayload,
    setClipboardPayload,
    clearClipboardPayload,
    setCurrentDragOperation,
    setDragSourceFileManagerInstanceId,
    setDragTargetFileManagerInstanceId,
    setDragSourceVfs,
    registerFileManagerVfs,
    unregisterFileManagerVfs,
    getFileManagerVfs,
  };
});
