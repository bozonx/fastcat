import { withWorkerFileIoSlot } from '../../workers/core/io-governor';

/**
 * Worker-side variant of {@link governedBlob}.
 * Wraps a Blob so that heavy I/O calls (arrayBuffer, text)
 * go through the worker interactive I/O budget.
 */
export function governedBlobWorker(file: File | Blob): Blob {
  return new Proxy(file, {
    get(target, prop) {
      if (prop === 'slice') {
        return (
          start?: number,
          end?: number,
          contentType?: string,
        ): Blob => governedBlobWorker(target.slice(start, end, contentType));
      }
      if (prop === 'arrayBuffer') {
        return () => withWorkerFileIoSlot(() => target.arrayBuffer());
      }
      if (prop === 'text') {
        return () => withWorkerFileIoSlot(() => target.text());
      }
      return Reflect.get(target, prop);
    },
  });
}
