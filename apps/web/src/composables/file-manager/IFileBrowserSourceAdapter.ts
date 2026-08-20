import type { Ref } from 'vue';
import type { FsEntry } from '~/types/fs';

/**
 * Abstracts over local and remote (e.g. BloggerDog) data sources for the file browser.
 * Implementations return `true` when they handle the operation, `false` to let the
 * base (local) logic proceed.
 */
export interface IFileBrowserSourceAdapter {
  /**
   * Try to load folder content into `folderEntries`.
   * @returns `true` if the adapter handled the operation (remote mode active).
   */
  loadFolder(options?: { append?: boolean }): Promise<boolean>;

  /**
   * Try to populate the breadcrumb parent-folders list.
   * @returns `true` if the adapter handled the operation.
   */
  buildParentFolders(parentFolders: Ref<FsEntry[]>): boolean;

  /**
   * Build a navigable directory entry for the given path.
   * Used by navigation helpers to construct history / root entries.
   */
  buildEntry(path: string, type?: string): FsEntry;
}
