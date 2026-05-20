import { useNuxtApp } from 'nuxt/app';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

export function useVfs(): IFileSystemAdapter {
  const _useNuxtApp =
    (globalThis as unknown as { useNuxtApp?: typeof useNuxtApp }).useNuxtApp || useNuxtApp;
  const nuxtApp = _useNuxtApp();
  return nuxtApp.$vfs as IFileSystemAdapter;
}
