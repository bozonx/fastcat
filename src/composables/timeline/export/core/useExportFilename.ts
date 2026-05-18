import { ref } from 'vue';
import {
  hasInvalidExportFilenameChars,
  normalizeExportFilename,
  resolveNextAvailableFilename,
} from '../filenameUtils';

export function useExportFilename(
  ext: import('vue').Ref<string>,
  ensureExportDir: () => Promise<FileSystemDirectoryHandle>,
  listExportFilenames: (exportDir: FileSystemDirectoryHandle) => Promise<Set<string>>,
) {
  const { t } = useI18n();
  const outputFilename = ref('');
  const filenameError = ref<string | null>(null);

  async function getNextAvailableFilename(base: string, ext: string) {
    const exportDir = await ensureExportDir();
    const names = await listExportFilenames(exportDir);
    return resolveNextAvailableFilename(names, base, ext);
  }

  async function validateFilename() {
    const normalized = normalizeExportFilename(outputFilename.value);
    if (outputFilename.value !== normalized) {
      outputFilename.value = normalized;
    }

    if (!normalized) {
      filenameError.value = t('videoEditor.export.filenameRequired');
      return false;
    }

    if (hasInvalidExportFilenameChars(normalized)) {
      filenameError.value = t('videoEditor.export.filenameInvalidChars');
      return false;
    }

    if (!normalized.toLowerCase().endsWith(`.${ext.value}`)) {
      filenameError.value = t('videoEditor.export.filenameInvalidExtension', { ext: ext.value });
      return false;
    }

    const exportDir = await ensureExportDir();
    const names = await listExportFilenames(exportDir);

    if (names.has(normalized)) {
      filenameError.value = t('videoEditor.export.filenameAlreadyExists');
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
