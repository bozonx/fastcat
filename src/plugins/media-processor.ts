import { defineNuxtPlugin } from 'nuxt/app';
import { createNativeMediaProcessor } from '~/media-processor/native.media-processor';
import { createWebMediaProcessor } from '~/media-processor/web.media-processor';
import { isTauriRuntime } from '~/utils/runtime';
import type { IMediaProcessor } from '~/media-processor/media-processor.types';

export default defineNuxtPlugin(async () => {
  const processor: IMediaProcessor = isTauriRuntime()
    ? createNativeMediaProcessor()
    : createWebMediaProcessor();

  return {
    provide: {
      mediaProcessor: processor,
    },
  };
});
