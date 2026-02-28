export interface FsEntry {
  name: string;
  kind: 'file' | 'directory';
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  parentHandle?: FileSystemDirectoryHandle;
  children?: FsEntry[];
  expanded?: boolean;
  path?: string;
  lastModified?: number;
}
