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

  const isBloggerDogProject = computed(() => {
    const entry = options.selectedFsEntry.value;
    if (entry?.source !== 'remote' || entry?.kind !== 'directory') return false;
    let path = entry.path || '';
    if (path.startsWith('/remote')) path = path.slice(7) || '/';
    const parts = path.split('/').filter(Boolean);
    return parts.length === 2 && parts[0] === 'projects';
  });

  const isBloggerDogGroup = computed(() => {
    const entry = options.selectedFsEntry.value;
    const path = entry?.path || '';
    const remoteId = entry?.remoteId || (entry?.remoteData as any)?.id;
    const isVirtual = ['virtual-all', 'personal', 'projects'].includes(remoteId);

    return (
      entry?.source === 'remote' &&
      entry?.kind === 'directory' &&
      !entry?.isContentItem &&
      path !== '/remote' &&
      path !== '/remote/' &&
      path !== '' &&
      !isVirtual &&
      !isBloggerDogProject.value
    );
  });

  const isBloggerDogContentItem = computed(() => {
    const entry = options.selectedFsEntry.value;
    return entry?.source === 'remote' && entry?.isContentItem;
  });

  const isBloggerDogMedia = computed(() => {
    const entry = options.selectedFsEntry.value;
    return entry?.source === 'remote' && entry?.isMediaItem;
  });

  const runtimeConfig = useRuntimeConfig();
  const bloggerDogDeepLink = computed(() => {
    const entry = options.selectedFsEntry.value;
    if (entry?.source !== 'remote') return null;

    const uiUrl = runtimeConfig.public.bloggerDogUiUrl;
    if (typeof uiUrl !== 'string' || !uiUrl) return null;

    const baseUrl = uiUrl.endsWith('/') ? uiUrl.slice(0, -1) : uiUrl;
    const remoteId = entry.remoteId || (entry.remoteData as any)?.id;
    const path = entry.path || '';

    let projectPrefix = '';
    if (path.startsWith('/projects/')) {
      const parts = path.split('/').filter(Boolean);
      if (parts.length >= 2) {
        projectPrefix = `/projects/${parts[1]}`;
      }
    }

    if ((remoteId === 'virtual-all' || remoteId === 'personal') && !isBloggerDogMedia.value) {
      return `${baseUrl}/content-library`;
    }

    if (remoteId === 'projects' && !isBloggerDogMedia.value) {
      return `${baseUrl}/projects`;
    }

    if (isBloggerDogMedia.value && entry.mediaId) {
      return `${baseUrl}${projectPrefix}/content-library?mediaId=${entry.mediaId}`;
    }

    if (isBloggerDogContentItem.value && remoteId) {
      return `${baseUrl}${projectPrefix}/content-library?openItemId=${remoteId}`;
    }

    if (isBloggerDogProject.value) {
      return `${baseUrl}${projectPrefix}`;
    }

    if (isBloggerDogGroup.value && remoteId) {
      return `${baseUrl}${projectPrefix}/content-library?groupId=${remoteId}`;
    }

    return null;
  });

  const { t } = useI18n();
  const generalInfoTitle = computed(() => {
    const info = options.fileInfo.value;
    if (!info) return '';

    if (isBloggerDogProject.value) return t('fastcat.file.bloggerDogProject', 'Проект');
    if (isBloggerDogGroup.value) return t('fastcat.file.bloggerDogGroup', 'Группа');
    if (isBloggerDogContentItem.value) return t('fastcat.file.bloggerDogItem', 'Элемент контента');

    if (info.kind === 'directory') return t('common.folder', 'Folder');
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
    isBloggerDogProject,
    isBloggerDogGroup,
    isBloggerDogContentItem,
    isBloggerDogMedia,
    bloggerDogDeepLink,
  };
}
