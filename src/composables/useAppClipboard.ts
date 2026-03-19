import { useClipboardStore } from '~/stores/clipboard.store';

export function useAppClipboard() {
  return useClipboardStore();
}
