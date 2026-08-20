import { nextTick, ref, type Ref } from 'vue';

const pendingUrls = new Set<string>();

function scheduleRevoke(url: string): void {
  pendingUrls.add(url);
  nextTick(() => {
    if (pendingUrls.has(url)) {
      pendingUrls.delete(url);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  });
}

/**
 * Safely revoke a blob URL, deferring until after the next DOM update tick.
 * This prevents `net::ERR_FILE_NOT_FOUND` when the browser cancels an in-flight
 * load for an `<img>` or `<video>` that was just unmounted or had its `src` changed.
 */
export function safeRevokeObjectURL(url: string | null | undefined): void {
  if (!url || !url.startsWith('blob:')) return;
  scheduleRevoke(url);
}

export interface SafeObjectUrl {
  url: Ref<string | null>;
  set: (url: string | null) => void;
  revoke: () => void;
}

/**
 * Vue-safe manager for a single blob/object URL.
 * Automatically defers `revokeObjectURL` to the next tick so the DOM
 * (and the browser's internal loader) has time to switch over.
 */
export function useSafeObjectUrl(): SafeObjectUrl {
  const url = ref<string | null>(null);

  function set(nextUrl: string | null): void {
    const previous = url.value;
    url.value = nextUrl;
    if (previous && previous !== nextUrl) {
      safeRevokeObjectURL(previous);
    }
  }

  function revoke(): void {
    safeRevokeObjectURL(url.value);
    url.value = null;
  }

  return { url, set, revoke };
}
