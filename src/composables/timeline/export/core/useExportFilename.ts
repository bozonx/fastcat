import { ref } from 'vue';
import { resolveNextAvailableFilename } from '../filenameUtils';

export function useExportFilename(
  ext: import('vue').Ref<string>,
  ensureExportDir: () => Promise<FileSystemDirectoryHandle>,
  listExportFilenames: (exportDir: FileSystemDirectoryHandle) => Promise<Set<string>>,
) {
  const outputFilename = ref('');
  const filenameError = ref<string | null>(null);

  async function getNextAvailableFilename(base: string, ext: string) {
    const exportDir = await ensureExportDir();
    const names = await listExportFilenames(exportDir);
    return resolveNextAvailableFilename(names, base, ext);
  }

  async function validateFilename() {
    const trimmed = outputFilename.value.trim();
    if (!trimmed) {
      filenameError.value = 'Filename is required';
      return false;
    }

    if (!trimmed.toLowerCase().endsWith(`.${ext.value}`)) {
      filenameError.value = `Filename must end with .${ext.value}`;
      return false;
    }

    const exportDir = await ensureExportDir();
    const names = await listExportFilenames(exportDir);

    if (names.has(trimmed)) {
      filenameError.value = 'A file with this name already exists';
      return false;
    }

    filenameError.value = null;
    return true;
  }

  return {
    outputFilename,
    filenameError,
    getNextAvailableFilename,
    validateFilename,
  };
}
