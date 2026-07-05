/* eslint-disable @typescript-eslint/unified-signatures */
import type { FsEntry } from './fs';

export type FileViewMode = 'grid' | 'list';
export type FileSortField = 'name' | 'type' | 'size' | 'modified' | 'created';
export type SortOrder = 'asc' | 'desc';

export interface FileSortOption {
  field: FileSortField;
  order: SortOrder;
}

export type ExtendedFsEntry = FsEntry & {
  objectUrl?: string;
  mimeType?: string;
  created?: number;
};

export interface FileBrowserViewEmits {
  (e: 'rootDragOver', event: DragEvent): void;
  (e: 'rootDragEnter', event: DragEvent): void;
  (e: 'rootDragLeave', event: DragEvent): void;
  (e: 'rootDrop', event: DragEvent): void;
  // Internal drags use the pointer-DnD engine: a row only needs to arm a drag on
  // pointerdown; enter/over/leave/drop are resolved centrally by hit-test.
  (e: 'entryPointerDown', event: PointerEvent, entry: FsEntry): void;
  (e: 'entryClick', event: MouseEvent, entry: FsEntry): void;
  (e: 'entryDoubleClick', entry: FsEntry): void;
  (e: 'entryEnter', entry: FsEntry): void;
  (e: 'commitRename', entry: FsEntry, name: string): void;
  (e: 'stopRename'): void;
  (e: 'fileAction', action: string, entry: FsEntry): void;
}

export interface FileBrowserListViewEmits extends FileBrowserViewEmits {
  (e: 'sort', field: FileSortField): void;
  (e: 'resizeStart', event: MouseEvent, column: string): void;
}
