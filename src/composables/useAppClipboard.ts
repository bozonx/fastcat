import { computed, ref } from 'vue';
import type { FsEntry } from '~/types/fs';

export interface FileManagerClipboardItem {
  path: string;
  kind: FsEntry['kind'];
  name: string;
}

export interface TimelineClipboardItem {
  trackId: string;
  itemId: string;
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

const clipboardPayload = ref<AppClipboardPayload | null>(null);
const currentDragOperation = ref<'copy' | 'move' | null>(null);

export function useAppClipboard() {
  const hasFileManagerPayload = computed(
    () => clipboardPayload.value?.source === 'fileManager' && clipboardPayload.value.items.length > 0,
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
}
