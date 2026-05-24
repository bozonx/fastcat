import { withFileIoSlot } from './io-governor';

/**
 * Wraps a Blob so that every heavy I/O call (arrayBuffer, text, stream)
 * goes through the interactive I/O budget on the main thread.
 *
 * Mediabunny's BlobSource performs random reads via slice()+arrayBuffer(),
 * each of which opens a short-lived datapipe. Routing them through the
 * governor prevents uncontrolled bursts that exhaust the Chromium pool.
 */
export function governedBlob(file: File | Blob): Blob {
  return new Proxy(file, {
    get(target, prop) {
      if (prop === 'slice') {
        return (
          start?: number,
          end?: number,
          contentType?: string,
        ): Blob => governedBlob(target.slice(start, end, contentType));
      }
      if (prop === 'arrayBuffer') {
        return () => withFileIoSlot(() => target.arrayBuffer());
      }
      if (prop === 'text') {
        return () => withFileIoSlot(() => target.text());
      }
      return Reflect.get(target, prop);
    },
  });
}
