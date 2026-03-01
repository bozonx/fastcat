import { computed, type Ref } from 'vue';

interface UseFilePropertiesBasicsOptions {
  selectedFsEntry: Ref<any>;
  fileInfo: Ref<any>;
  isOtio: Ref<boolean>;
  mediaType: Ref<string | null | undefined>;
}

export function useFilePropertiesBasics(options: UseFilePropertiesBasicsOptions) {
  const selectedPath = computed<string | null>(() => {
    const entry = options.selectedFsEntry.value;
    return typeof entry?.path === 'string' && entry.path.length > 0 ? entry.path : null;
  });

  const isHidden = computed(() => {
    const entry = options.selectedFsEntry.value;
    const name = typeof entry?.name === 'string' ? entry.name : '';
    return name.startsWith('.');
  });

  const ext = computed(() => {
    const entry = options.selectedFsEntry.value;
    const name = typeof entry?.name === 'string' ? entry.name : '';
    const value = name.split('.').pop()?.toLowerCase() ?? '';
    return value && value !== name.toLowerCase() ? value : value;
  });

  const generalInfoTitle = computed(() => {
    const info = options.fileInfo.value;
    if (!info) return '';
    if (info.kind === 'directory') return 'Folder';
    if (options.isOtio.value) return 'OTIO';

    if (options.mediaType.value === 'text') {
      const ext = options.fileInfo.value?.ext?.toLowerCase();
      if (ext === 'json') return 'JSON';
      if (ext === 'md' || ext === 'markdown') return 'Markdown';
      if (ext === 'yaml' || ext === 'yml') return 'YAML';
      return 'Text';
    }

    return info.mimeType ?? 'File';
  });

  const mediaMeta = computed(() => options.fileInfo.value?.metadata as any);

  const isVideoOrAudio = computed(() => {
    return options.mediaType.value === 'video' || options.mediaType.value === 'audio';
  });

  return {
    ext,
    generalInfoTitle,
    isHidden,
    isVideoOrAudio,
    mediaMeta,
    selectedPath,
  };
}
