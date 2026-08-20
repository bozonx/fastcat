import { computed, type Ref } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { isWorkspaceCommonPath, WORKSPACE_COMMON_PATH_PREFIX } from '~/utils/workspace-common';

export interface FilePropertiesContextDeps {
  selectedFsEntry: () => FsEntry;
  isExternal: () => boolean | undefined;
  selectionOrigin: () => 'project-manager' | 'workspace-browser' | 'remote-browser' | undefined;
  instanceId: () => string | undefined;
  /** External ("computer") VFS used when browsing outside the project. */
  computerVfs: Ref<IFileSystemAdapter | null | undefined>;
  /** Project VFS getter (from useFileManager). */
  fileManagerVfs: () => IFileSystemAdapter;
}

/**
 * Context detection for the selected entry: remote vs local, external browsing
 * context, root/common/workspace-root classification, the effective VFS to read
 * from, and the metadata cache key. Extracted from `FileProperties.vue`.
 *
 * `isProjectRootDirInContext` stays in the component because it depends on
 * `isProjectRootDir` from `useFileStorageInfo`, which in turn consumes
 * `isExternalContext` produced here.
 */
export function useFilePropertiesContext(deps: FilePropertiesContextDeps) {
  const isRemoteEntry = computed(() => deps.selectedFsEntry()?.source === 'remote');

  const isRemoteFileEntry = computed(
    () => isRemoteEntry.value && deps.selectedFsEntry()?.kind === 'file',
  );

  const hasAbsoluteLocalPath = computed(() => {
    if (isRemoteEntry.value) return false;
    const path = deps.selectedFsEntry()?.path;
    if (typeof path !== 'string' || path.length === 0) return false;
    return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path);
  });

  const isExternalContext = computed(
    () =>
      (!isRemoteEntry.value && deps.isExternal()) ||
      (!isRemoteEntry.value &&
        (deps.selectionOrigin() === 'workspace-browser' ||
          deps.selectionOrigin() === 'remote-browser' ||
          deps.instanceId() === 'computer' ||
          deps.instanceId() === 'sidebar' ||
          hasAbsoluteLocalPath.value)),
  );

  const isRootDirectory = computed(() => {
    const entry = deps.selectedFsEntry();
    return entry?.kind === 'directory' && (entry.path === '' || entry.path === '/');
  });

  const isWorkspaceRootProperties = computed(
    () =>
      isRootDirectory.value &&
      isExternalContext.value &&
      deps.selectedFsEntry()?.kind === 'directory',
  );

  const effectiveVfs = computed(() =>
    isExternalContext.value
      ? (deps.computerVfs.value ?? deps.fileManagerVfs())
      : deps.fileManagerVfs(),
  );

  const metadataCacheKey = computed(() => {
    const path = deps.selectedFsEntry()?.path;
    if (!path) return null;
    return isExternalContext.value || isRemoteFileEntry.value ? `external:${path}` : path;
  });

  const isCommonRoot = computed(() => {
    const entry = deps.selectedFsEntry();
    if (!entry || entry.kind !== 'directory') return false;
    return (
      entry.path === WORKSPACE_COMMON_PATH_PREFIX ||
      (entry.name.toLowerCase() === 'common' && (entry.path === 'common' || entry.path === ''))
    );
  });

  // Matches all items within common (visual indicators only, not action-blocking).
  const isCommonPath = computed(() => isWorkspaceCommonPath(deps.selectedFsEntry()?.path));

  const isRemoteRoot = computed(() => {
    const entry = deps.selectedFsEntry();
    const path = entry?.path || '';
    return (
      entry?.source === 'remote' &&
      (path === '' || path === '/' || path === '/remote' || path === '/remote/')
    );
  });

  return {
    isRemoteEntry,
    isRemoteFileEntry,
    hasAbsoluteLocalPath,
    isExternalContext,
    isRootDirectory,
    isWorkspaceRootProperties,
    effectiveVfs,
    metadataCacheKey,
    isCommonRoot,
    isCommonPath,
    isRemoteRoot,
  };
}
