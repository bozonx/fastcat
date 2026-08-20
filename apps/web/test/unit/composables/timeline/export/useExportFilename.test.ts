/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { useExportFilename } from '~/composables/timeline/export/core/useExportFilename';

const tMock = (key: string, params?: Record<string, any>) => {
  if (params?.ext) {
    return `${key}:${params.ext}`;
  }
  return key;
};

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: tMock,
    locale: ref('en-US'),
  }),
}));

vi.mock('#i18n', () => ({
  useI18n: () => ({
    t: tMock,
    locale: ref('en-US'),
  }),
}));

vi.stubGlobal('useI18n', () => ({
  t: tMock,
  locale: ref('en-US'),
}));

describe('useExportFilename', () => {
  const mockExportDir = { name: '_export' } as unknown as FileSystemDirectoryHandle;
  const ensureExportDirMock = vi.fn(async () => mockExportDir);
  const listExportFilenamesMock = vi.fn(async () => new Set<string>());

  beforeEach(() => {
    ensureExportDirMock.mockClear();
    listExportFilenamesMock.mockClear();
    listExportFilenamesMock.mockResolvedValue(new Set<string>());
  });

  it('требует указания имени файла', async () => {
    const { outputFilename, filenameError, validateFilename } = useExportFilename(
      ensureExportDirMock,
      listExportFilenamesMock,
    );

    outputFilename.value = '   ';
    const isValid = await validateFilename();
    expect(isValid).toBe(false);
    expect(filenameError.value).toBe('videoEditor.export.filenameRequired');
  });

  it('запрещает недопустимые символы в имени файла', async () => {
    const { outputFilename, filenameError, validateFilename } = useExportFilename(
      ensureExportDirMock,
      listExportFilenamesMock,
    );

    outputFilename.value = 'video/export.mp4';
    let isValid = await validateFilename();
    expect(isValid).toBe(false);
    expect(filenameError.value).toBe('videoEditor.export.filenameInvalidChars');

    outputFilename.value = 'video*1.mp4';
    isValid = await validateFilename();
    expect(isValid).toBe(false);
    expect(filenameError.value).toBe('videoEditor.export.filenameInvalidChars');
  });

  it('разрешает любое расширение файла (не валидирует расширение)', async () => {
    const { outputFilename, filenameError, validateFilename } = useExportFilename(
      ensureExportDirMock,
      listExportFilenamesMock,
    );

    outputFilename.value = 'video.webm';
    let isValid = await validateFilename();
    expect(isValid).toBe(true);
    expect(filenameError.value).toBeNull();

    outputFilename.value = 'video.whatever';
    isValid = await validateFilename();
    expect(isValid).toBe(true);
    expect(filenameError.value).toBeNull();
  });

  it('предотвращает перезапись существующего файла', async () => {
    listExportFilenamesMock.mockResolvedValue(new Set(['video.mp4', 'exists.mp4']));

    const { outputFilename, filenameError, validateFilename } = useExportFilename(
      ensureExportDirMock,
      listExportFilenamesMock,
    );

    outputFilename.value = 'exists.mp4';
    const isValid = await validateFilename();
    expect(isValid).toBe(false);
    expect(filenameError.value).toBe('videoEditor.export.filenameAlreadyExists');
  });

  it('генерирует следующее доступное имя файла', async () => {
    listExportFilenamesMock.mockResolvedValue(new Set(['video.mp4', 'video_001.mp4']));

    const { getNextAvailableFilename } = useExportFilename(
      ensureExportDirMock,
      listExportFilenamesMock,
    );

    const nextName = await getNextAvailableFilename('video', 'mp4');
    expect(nextName).toBe('video_002.mp4');
  });
});
