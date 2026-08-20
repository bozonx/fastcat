import { defineNuxtPlugin } from 'nuxt/app';
import { isTauriRuntime } from '~/utils/runtime';
import type { IMediaProcessor } from '~/media-processor/media-processor.types';

export default defineNuxtPlugin(async () => {
  const processor: IMediaProcessor = isTauriRuntime()
    ? (await import('~/media-processor/native.media-processor')).createNativeMediaProcessor()
    : (await import('~/media-processor/web.media-processor')).createWebMediaProcessor();

  return {
    provide: {
      mediaProcessor: processor,
    },
  };
});
