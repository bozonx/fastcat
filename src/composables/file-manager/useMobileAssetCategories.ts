import { ref, reactive } from 'vue';
import type { FsEntry } from '~/types/fs';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';
import { useFileBrowserEntries } from '~/composables/file-manager/useFileBrowserEntries';
import {
  VIDEO_DIR_NAME,
  AUDIO_DIR_NAME,
  IMAGES_DIR_NAME,
  EXPORT_DIR_NAME,
  DOCUMENTS_DIR_NAME,
  FILES_DIR_NAME,
} from '~/utils/constants';

export type AssetCategoryId = 'video' | 'audio' | 'images' | 'export' | 'documents' | 'files';

const CATEGORY_DIRS: Record<AssetCategoryId, string> = {
  video: VIDEO_DIR_NAME,
  audio: AUDIO_DIR_NAME,
  images: IMAGES_DIR_NAME,
  export: EXPORT_DIR_NAME,
  documents: DOCUMENTS_DIR_NAME,
  files: FILES_DIR_NAME,
};

const CATEGORY_LABEL_KEYS: Record<AssetCategoryId, string> = {
  video: 'common.video',
  audio: 'common.audio',
  images: 'common.images',
  export: 'common.export',
  documents: 'common.documents',
  files: 'common.files',
};

const CATEGORY_ICONS: Record<AssetCategoryId, string> = {
  video: 'lucide:clapperboard',
  audio: 'lucide:music',
  images: 'lucide:image',
  export: 'lucide:download',
  documents: 'lucide:file-text',
  files: 'lucide:folder-open',
};

const CATEGORY_ORDER: AssetCategoryId[] = ['video', 'audio', 'images', 'export', 'documents', 'files'];

// Collapse state persists for the app lifetime so it survives switching between
// the Assets/Files tabs (which mount/unmount the browser components).
const collapsedState = reactive<Record<AssetCategoryId, boolean>>({
  video: false,
  audio: false,
  images: false,
  export: false,
  documents: false,
  files: false,
});

interface Deps {
  vfs: IFileSystemAdapter;
  readDirectory: (path?: string) => Promise<FsEntry[]>;
  reloadDirectory: (path: string) => Promise<void>;
}

/**
 * Reads the project's fixed asset folders (`_video`, `_audio`, `_images`) and
 * exposes one reactive bucket per category, mirroring the file-browser entry
 * pipeline (sorting, thumbnails, compatibility). Only the top level of each
 * folder is read — nested folders are not supported yet.
 */
export function useMobileAssetCategories({ vfs, readDirectory, reloadDirectory }: Deps) {
  const isRemoteMode = ref(false);

  const categories = CATEGORY_ORDER.map((id) => {
    const entries = useFileBrowserEntries({ isRemoteMode, vfs });
    const isLoading = ref(false);
    const error = ref<string | null>(null);

    async function load(force = false) {
      const path = CATEGORY_DIRS[id];
      isLoading.value = true;
      error.value = null;
      try {
        const meta = await vfs.getMetadata(path).catch(() => null);
        if (!meta || meta.kind !== 'directory') {
          entries.folderEntries.value = [];
          return;
        }
        if (force) await reloadDirectory(path);
        const raw = await readDirectory(path);
        // Top level only: ignore nested folders for now.
        const files = raw.filter((e) => e.kind === 'file');
        entries.folderEntries.value = await entries.supplementEntries(files);
      } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        entries.folderEntries.value = [];
      } finally {
        isLoading.value = false;
      }
    }

    return {
      id,
      dirPath: CATEGORY_DIRS[id],
      labelKey: CATEGORY_LABEL_KEYS[id],
      icon: CATEGORY_ICONS[id],
      isLoading,
      error,
      sortedEntries: entries.sortedEntries,
      thumbnails: entries.videoThumbnails,
      fileCompatibility: entries.fileCompatibility,
      load,
    };
  });

  async function loadAll(force = false) {
    await Promise.all(categories.map((c) => c.load(force)));
  }

  function toggleCollapse(id: AssetCategoryId) {
    collapsedState[id] = !collapsedState[id];
  }

  function isCollapsed(id: AssetCategoryId) {
    return collapsedState[id];
  }

  return { categories, loadAll, toggleCollapse, isCollapsed };
}
