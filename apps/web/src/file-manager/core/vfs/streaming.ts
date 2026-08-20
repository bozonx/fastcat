import { throwIfAborted } from './errors';

/**
 * Wrap a byte reader in a backpressure-aware `ReadableStream` that releases its
 * streaming I/O-governor slot exactly once — when the source is exhausted,
 * errors, or the consumer cancels. Shared by the OPFS and Tauri VFS adapters,
 * which only differ in how they obtain the underlying reader.
 */
export function createGovernedReadStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: { releaseIo: () => void; signal?: AbortSignal; path: string },
): ReadableStream<Uint8Array> {
  const { releaseIo, signal, path } = options;
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    releaseIo();
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        throwIfAborted(signal, path);
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          releaseOnce();
          return;
        }
        if (value) controller.enqueue(value);
      } catch (e) {
        releaseOnce();
        controller.error(e);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        releaseOnce();
      }
    },
  });
}
