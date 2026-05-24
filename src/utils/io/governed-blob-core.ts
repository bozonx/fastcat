export type GovernedBlobSlot = <T>(task: () => Promise<T>) => Promise<T>;

export interface GovernedBlobOptions {
  withIoSlot: GovernedBlobSlot;
}

/**
 * Creates a Blob/File proxy that keeps native Blob brand checks intact while
 * routing random-access reads through the shared I/O governor.
 */
export function createGovernedBlob(file: File, options: GovernedBlobOptions): File;
export function createGovernedBlob(file: Blob, options: GovernedBlobOptions): Blob;
export function createGovernedBlob(file: File | Blob, options: GovernedBlobOptions): File | Blob {
  const proxy = new Proxy(file, {
    has(target, prop) {
      if (prop === 'stream') {
        return false;
      }
      return prop in target;
    },
    get(target, prop) {
      if (prop === 'slice') {
        return (start?: number, end?: number, contentType?: string): Blob =>
          createGovernedBlob(target.slice(start, end, contentType), options);
      }
      if (prop === 'arrayBuffer') {
        return () => options.withIoSlot(() => target.arrayBuffer());
      }
      if (prop === 'text') {
        return () => options.withIoSlot(() => target.text());
      }

      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return proxy as File | Blob;
}
