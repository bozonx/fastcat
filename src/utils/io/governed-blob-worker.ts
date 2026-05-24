import { withWorkerFileIoSlot } from '../../workers/core/io-governor';
import { createGovernedBlob } from './governed-blob-core';

/**
 * Worker-side variant of {@link governedBlob}.
 * Wraps a Blob so that heavy I/O calls (arrayBuffer, text)
 * go through the worker interactive I/O budget.
 */
export function governedBlobWorker(file: File): File;
export function governedBlobWorker(file: Blob): Blob;
export function governedBlobWorker(file: File | Blob): File | Blob {
  return createGovernedBlob(file, { withIoSlot: withWorkerFileIoSlot });
}
