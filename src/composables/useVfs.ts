import { useNuxtApp } from '#app';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

export function useVfs(): IFileSystemAdapter {
  const nuxtApp = useNuxtApp();
  return nuxtApp.$vfs as IFileSystemAdapter;
}
