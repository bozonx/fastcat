import { useNuxtApp } from 'nuxt/app';
import type { IMediaProcessor } from '~/media-processor/media-processor.types';

export function useMediaProcessor(): IMediaProcessor {
  const _useNuxtApp =
    (globalThis as unknown as { useNuxtApp?: typeof useNuxtApp }).useNuxtApp || useNuxtApp;
  const nuxtApp = _useNuxtApp();
  return nuxtApp.$mediaProcessor as IMediaProcessor;
}
