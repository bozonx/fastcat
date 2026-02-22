import { ref, computed } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';
import { useUiStore } from '~/stores/ui.store';
import { useMediaStore } from '~/stores/media.store';

export interface FsEntry {
  name: string;
  kind: 'file' | 'directory';
  handle: FileSystemFileHandle | FileSystemDirectoryHandle;
  parentHandle?: FileSystemDirectoryHandle;
  children?: FsEntry[];
  expanded?: boolean;
  path?: string;
}

export function useFileManager() {
  const workspaceStore = useWorkspaceStore();
  const projectStore = useProjectStore();
  const uiStore = useUiStore();
  const mediaStore = useMediaStore();

  const rootEntries = ref<FsEntry[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const isApiSupported = workspaceStore.isApiSupported;

  async function readDirectory(
    dirHandle: FileSystemDirectoryHandle,
    basePath = '',
  ): Promise<FsEntry[]> {
    const entries: FsEntry[] = [];
    try {
      const iterator = (dirHandle as any).values?.() ?? (dirHandle as any).entries?.();
      if (!iterator) return entries;

      for await (const value of iterator) {
        const handle = Array.isArray(value) ? value[1] : value;
        entries.push({
          name: handle.name,
          kind: handle.kind,
          handle,
          parentHandle: dirHandle,
          children: undefined,
          expanded: false,
          path: basePath ? `${basePath}/${handle.name}` : handle.name,
        });
      }
    } catch (e: any) {
      throw new Error(e?.message ?? 'Failed to read directory');
    }
    return entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  async function toggleDirectory(entry: FsEntry) {
    if (entry.kind !== 'directory') return;
    error.value = null;
    entry.expanded = !entry.expanded;

    if (entry.path) {
      if (projectStore.currentProjectName) {
        uiStore.setFileTreePathExpanded(
          projectStore.currentProjectName,
          entry.path,
          entry.expanded,
        );
      }
    }

    if (entry.expanded && entry.children === undefined) {
      try {
        entry.children = await readDirectory(entry.handle as FileSystemDirectoryHandle, entry.path);
      } catch (e: any) {
        error.value = e?.message ?? 'Failed to read folder';
        entry.expanded = false;

        if (entry.path) {
          if (projectStore.currentProjectName) {
            uiStore.setFileTreePathExpanded(projectStore.currentProjectName, entry.path, false);
          }
        }
      }
    }
  }

  async function expandPersistedDirectories() {
    const projectName = projectStore.currentProjectName;
    if (!projectName) return;

    const expandedPaths = Object.keys(uiStore.fileTreeExpandedPaths);
    if (expandedPaths.length === 0) return;

    const sortedPaths = [...expandedPaths].sort((a, b) => a.length - b.length);

    for (const path of sortedPaths) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length === 0) continue;

      let currentList = rootEntries.value;
      let currentPath = '';
      for (const part of parts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const entry = currentList.find((e) => e.kind === 'directory' && e.name === part);
        if (!entry) break;

        if (!entry.expanded) {
          await toggleDirectory(entry);
        } else if (entry.children === undefined) {
          entry.children = await readDirectory(
            entry.handle as FileSystemDirectoryHandle,
            entry.path,
          );
        }

        if (!uiStore.isFileTreePathExpanded(currentPath)) {
          uiStore.setFileTreePathExpanded(projectName, currentPath, true);
        }

        currentList = entry.children ?? [];
      }
    }
  }

  async function loadProjectDirectory() {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) {
      rootEntries.value = [];
      return;
    }

    error.value = null;
    isLoading.value = true;
    try {
      const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(
        projectStore.currentProjectName,
      );
      rootEntries.value = await readDirectory(projectDir);

      await expandPersistedDirectories();

      // Automatically expand the sources directory if present
      for (const entry of rootEntries.value) {
        if (entry.kind === 'directory' && entry.name === 'sources') {
          if (!entry.expanded) await toggleDirectory(entry);
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        error.value = e?.message ?? 'Failed to open project folder';
      }
    } finally {
      isLoading.value = false;
    }
  }

  async function handleFiles(files: FileList | File[]) {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

    error.value = null;
    isLoading.value = true;
    try {
      const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(
        projectStore.currentProjectName,
      );
      const sourcesDir = await projectDir.getDirectoryHandle('sources', { create: true });

      for (const file of Array.from(files)) {
        let targetDirName = 'video';
        if (file.type.startsWith('audio/')) targetDirName = 'audio';
        else if (file.type.startsWith('image/')) targetDirName = 'images';
        else if (!file.type.startsWith('video/')) {
          if (file.name.endsWith('.otio')) continue; // Skip project files
        }

        const targetDir = await sourcesDir.getDirectoryHandle(targetDirName, { create: true });
        const fileHandle = await targetDir.getFileHandle(file.name, { create: true });
        const writable = await (fileHandle as any).createWritable();
        await writable.write(file);
        await writable.close();

        if (file.type.startsWith('video/') || file.type.startsWith('audio/')) {
          const projectRelativePath = `sources/${targetDirName}/${file.name}`;
          void mediaStore.getOrFetchMetadata(fileHandle, projectRelativePath);
        }
      }

      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to upload files';
    } finally {
      isLoading.value = false;
    }
  }

  async function createFolder(name: string, targetEntry: FileSystemDirectoryHandle | null = null) {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

    error.value = null;
    isLoading.value = true;
    try {
      const baseDir =
        targetEntry ||
        (await workspaceStore.projectsHandle.getDirectoryHandle(projectStore.currentProjectName));
      await baseDir.getDirectoryHandle(name, { create: true });
      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to create folder';
    } finally {
      isLoading.value = false;
    }
  }

  async function deleteEntry(target: FsEntry) {
    error.value = null;
    isLoading.value = true;
    try {
      const parent = target.parentHandle;
      if (parent) {
        await parent.removeEntry(target.name, { recursive: true });
      }
      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to delete';
    } finally {
      isLoading.value = false;
    }
  }

  async function renameEntry(target: FsEntry, newName: string) {
    if (!target.parentHandle) return;

    error.value = null;
    isLoading.value = true;
    try {
      const parent = target.parentHandle;
      if (target.kind === 'file') {
        const handle = target.handle as any;
        if (typeof handle.move === 'function') {
          await handle.move(newName);
        } else {
          const file = await (handle as FileSystemFileHandle).getFile();
          const newHandle = await parent.getFileHandle(newName, { create: true });
          const writable = await (newHandle as any).createWritable();
          await writable.write(file);
          await writable.close();
          await parent.removeEntry(target.name);
        }
      } else {
        const oldHandle = target.handle as FileSystemDirectoryHandle;
        const newHandle = await parent.getDirectoryHandle(newName, { create: true });

        async function copyDirectory(
          srcDir: FileSystemDirectoryHandle,
          destDir: FileSystemDirectoryHandle,
        ) {
          const iterator = (srcDir as any).values?.() ?? (srcDir as any).entries?.();
          if (!iterator) return;
          for await (const value of iterator) {
            const handle = Array.isArray(value) ? value[1] : value;
            if (handle.kind === 'file') {
              const file = await handle.getFile();
              const newFileHandle = await destDir.getFileHandle(handle.name, { create: true });
              const writable = await (newFileHandle as any).createWritable();
              await writable.write(file);
              await writable.close();
            } else if (handle.kind === 'directory') {
              const newSubDir = await destDir.getDirectoryHandle(handle.name, { create: true });
              await copyDirectory(handle, newSubDir);
            }
          }
        }

        await copyDirectory(oldHandle, newHandle);
        await parent.removeEntry(target.name, { recursive: true });
      }

      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to rename';
    } finally {
      isLoading.value = false;
    }
  }

  async function createTimeline() {
    if (!workspaceStore.projectsHandle || !projectStore.currentProjectName) return;

    error.value = null;
    isLoading.value = true;
    try {
      const projectDir = await workspaceStore.projectsHandle.getDirectoryHandle(
        projectStore.currentProjectName,
      );
      const sourcesDir = await projectDir.getDirectoryHandle('sources', { create: true });
      const timelinesDir = await sourcesDir.getDirectoryHandle('timelines', { create: true });

      // Find unique filename
      let index = 1;
      let fileName = '';
      let exists = true;
      while (exists) {
        fileName = `timeline_${String(index).padStart(3, '0')}.otio`;
        try {
          await timelinesDir.getFileHandle(fileName);
          index++;
        } catch (e) {
          exists = false;
        }
      }

      const fileHandle = await timelinesDir.getFileHandle(fileName, { create: true });
      const writable = await (fileHandle as any).createWritable();
      await writable.write(`{
  "OTIO_SCHEMA": "Timeline.1",
  "name": "${fileName.replace('.otio', '')}",
  "tracks": {
    "OTIO_SCHEMA": "Stack.1",
    "children": [],
    "name": "tracks"
  }
}`);
      await writable.close();

      await loadProjectDirectory();
    } catch (e: any) {
      error.value = e?.message ?? 'Failed to create timeline';
    } finally {
      isLoading.value = false;
    }
  }

  function getFileIcon(entry: FsEntry): string {
    if (entry.kind === 'directory') return 'i-heroicons-folder';
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
    if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return 'i-heroicons-film';
    if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return 'i-heroicons-musical-note';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'i-heroicons-photo';
    if (ext === 'otio') return 'i-heroicons-document-text';
    return 'i-heroicons-document';
  }

  return {
    rootEntries,
    isLoading,
    error,
    isApiSupported,
    loadProjectDirectory,
    toggleDirectory,
    handleFiles,
    createFolder,
    deleteEntry,
    renameEntry,
    createTimeline,
    getFileIcon,
  };
}
