import { computed, type ComputedRef } from 'vue';
import { useClipboardStore } from '~/stores/clipboard.store';

export function useClipboardIndicator(entryPath: string | undefined): ComputedRef<boolean> {
  const clipboardStore = useClipboardStore();

  return computed(() => {
    const payload = clipboardStore.clipboardPayload;
    if (!payload || payload.source !== 'fileManager' || payload.operation !== 'cut') {
      return false;
    }
    if (!entryPath) return false;
    return payload.items.some((item) => item.path === entryPath);
  });
}

export function useClipboardPaths(): ComputedRef<Set<string>> {
  const clipboardStore = useClipboardStore();

  return computed(() => {
    const payload = clipboardStore.clipboardPayload;
    if (!payload || payload.source !== 'fileManager' || payload.operation !== 'cut') {
      return new Set();
    }
    return new Set(payload.items.map((item) => item.path));
  });
}
