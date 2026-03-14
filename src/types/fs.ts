export interface FsEntry {
  name: string;
  kind: 'file' | 'directory';
  path: string;
  parentPath?: string;
  children?: FsEntry[];
  expanded?: boolean;
  lastModified?: number;
  size?: number;
  source?: 'local' | 'remote';
  remoteId?: string;
  remotePath?: string;
  remoteData?: unknown;
  hasChildren?: boolean;
  hasDirectories?: boolean;
}
