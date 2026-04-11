import { computed, type Ref } from 'vue';
import { getBdPayload } from '~/types/bloggerdog';

interface UseFilePropertiesBasicsOptions {
  selectedFsEntry: Ref<any>;
  fileInfo: Ref<any>;
  isOtio: Ref<boolean>;
  mediaType: Ref<string | null | undefined>;
}

export function useFilePropertiesBasics(options: UseFilePropertiesBasicsOptions) {
  const bd = computed(() => getBdPayload(options.selectedFsEntry.value ?? {}));

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

  const isBloggerDogProject = computed(() => bd.value?.type === 'project');
  const isBloggerDogGroup = computed(() => bd.value?.type === 'collection');
  const isBloggerDogContentItem = computed(() => bd.value?.type === 'content-item');
  const isBloggerDogMedia = computed(() => bd.value?.type === 'media');
  const isBloggerDogVirtualFolder = computed(() => bd.value?.type === 'virtual-folder');

  const runtimeConfig = useRuntimeConfig();
  const bloggerDogDeepLink = computed(() => {
    const entry = options.selectedFsEntry.value;
    if (entry?.source !== 'remote') return null;

    const uiUrl = runtimeConfig.public.bloggerDogUiUrl;
    if (typeof uiUrl !== 'string' || !uiUrl) return null;

    const baseUrl = uiUrl.endsWith('/') ? uiUrl.slice(0, -1) : uiUrl;
    const remoteId = entry.remoteId || bd.value?.remoteData?.id;
    let normalizedPath = entry.path || '';
    if (normalizedPath.startsWith('/remote')) normalizedPath = normalizedPath.slice(7) || '/';

    let projectPrefix = '';
    if (normalizedPath.startsWith('/projects/')) {
      const parts = normalizedPath.split('/').filter(Boolean);
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

    if (isBloggerDogMedia.value && bd.value?.mediaId) {
      return `${baseUrl}${projectPrefix}/content-library?mediaId=${bd.value.mediaId}`;
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
    const info = options.fileInfo.value || options.selectedFsEntry.value;
    if (!info) return '';

    if (info.kind === 'directory') {
      if (isBloggerDogProject.value) return t('fastcat.file.bloggerDogProject');
      if (isBloggerDogGroup.value) return t('fastcat.file.bloggerDogGroup');
      if (isBloggerDogContentItem.value) return t('fastcat.file.bloggerDogItem');
      return t('common.folder');
    }

    if (options.isOtio.value) return 'OTIO';

    return info.mimeType ?? t('common.file');
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
