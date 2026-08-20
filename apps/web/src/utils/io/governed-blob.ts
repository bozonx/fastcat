import { withFileIoSlot } from './io-governor';
import { createGovernedBlob } from './governed-blob-core';

/**
 * Wraps a Blob so that every heavy I/O call (arrayBuffer, text)
 * goes through the interactive I/O budget on the main thread.
 *
 * Mediabunny's BlobSource performs random reads via slice()+arrayBuffer(),
 * each of which opens a short-lived datapipe. Routing them through the
 * governor prevents uncontrolled bursts that exhaust the Chromium pool.
 */
export function governedBlob(file: File): File;
export function governedBlob(file: Blob): Blob;
export function governedBlob(file: File | Blob): File | Blob {
  return createGovernedBlob(file, { withIoSlot: withFileIoSlot });
}
