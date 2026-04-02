import { useNuxtApp } from '#app';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

export function useVfs(): IFileSystemAdapter {
  const _useNuxtApp: any = (globalThis as any).useNuxtApp || useNuxtApp;
  const nuxtApp = _useNuxtApp();
  return nuxtApp.$vfs as IFileSystemAdapter;
}
