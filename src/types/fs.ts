import type { VfsEntry } from '~/file-manager/core/vfs/types';

export interface FsEntry extends Omit<VfsEntry, 'children'> {
  children?: FsEntry[];
  source?: 'local' | 'remote';
  remoteId?: string;
  remotePath?: string;
}
