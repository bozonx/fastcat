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
  let validationToken = 0;

  async function getNextAvailableFilename(base: string, extVal: string) {
    const exportDir = await ensureExportDir();
    const names = await listExportFilenames(exportDir);
    return resolveNextAvailableFilename(names, base, extVal);
  }

  async function validateFilename() {
    const token = ++validationToken;

    const normalized = normalizeExportFilename(outputFilename.value);
    if (outputFilename.value !== normalized) {
      if (token !== validationToken) return false;
      outputFilename.value = normalized;
    }

    if (!normalized) {
      if (token !== validationToken) return false;
      filenameError.value = t('videoEditor.export.filenameRequired');
      return false;
    }

    if (hasInvalidExportFilenameChars(normalized)) {
      if (token !== validationToken) return false;
      filenameError.value = t('videoEditor.export.filenameInvalidChars');
      return false;
    }

    if (!normalized.toLowerCase().endsWith(`.${ext.value}`)) {
      if (token !== validationToken) return false;
      filenameError.value = t('videoEditor.export.filenameInvalidExtension', { ext: ext.value });
      return false;
    }

    const exportDir = await ensureExportDir();
    if (token !== validationToken) return false;

    const names = await listExportFilenames(exportDir);
    if (token !== validationToken) return false;

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
