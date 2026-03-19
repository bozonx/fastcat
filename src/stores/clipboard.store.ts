import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import type { FsEntry } from '~/types/fs';
import type { TimelineClipItem } from '~/timeline/types';

export interface FileManagerClipboardItem {
  path: string;
  kind: FsEntry['kind'];
  name: string;
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

  return {
    clipboardPayload,
    currentDragOperation,
    hasFileManagerPayload,
    hasTimelinePayload,
    setClipboardPayload,
    clearClipboardPayload,
    setCurrentDragOperation,
  };
});
