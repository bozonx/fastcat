import { createDevLogger } from '~/utils/dev-logger';
import { runResilientFileWrite } from '~/utils/io/io-governor';
import type { EmbedAssetTransport } from './asset-transport';

const log = createDevLogger('embed-asset-ingest');

/** Bytes pulled per network round trip while materialising an asset. */
const DOWNLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

/** Narrows the buffer type the File System API insists on. */
function toWritableChunk(chunk: Uint8Array): ArrayBufferView<ArrayBuffer> {
  return chunk as unknown as ArrayBufferView<ArrayBuffer>;
}

export interface DownloadAssetOptions {
  transport: EmbedAssetTransport;
  /** Destination handle inside the session's project directory. */
  fileHandle: FileSystemFileHandle;
  onProgress?: (loadedBytes: number, totalBytes: number | null) => void;
  signal?: AbortSignal;
}

/**
 * Materialises the whole asset into the project, chunk by chunk.
 *
 * Runs behind the timeline rather than in front of it: by the time this
 * finishes the user has usually already trimmed. Writes go through the shared
 * file-I/O budget so a background download cannot starve the reads that preview
 * playback is making at the same time.
 */
export async function downloadAssetToFile(options: DownloadAssetOptions): Promise<number> {
  const { transport, fileHandle, onProgress, signal } = options;
  const totalBytes = await transport.getSize();

  const writable = await runResilientFileWrite(() => fileHandle.createWritable());
  let written = 0;

  try {
    if (totalBytes === null) {
      // No advertised size: take whatever the server sends in one pass.
      const chunk = await transport.readRange(0, Number.MAX_SAFE_INTEGER);
      await writable.write(toWritableChunk(chunk));
      written = chunk.byteLength;
      onProgress?.(written, null);
      return written;
    }

    while (written < totalBytes) {
      signal?.throwIfAborted();
      const end = Math.min(written + DOWNLOAD_CHUNK_BYTES, totalBytes);
      const chunk = await transport.readRange(written, end);
      if (!chunk.byteLength) break;

      await writable.write(toWritableChunk(chunk));
      written += chunk.byteLength;
      onProgress?.(written, totalBytes);
    }

    if (written !== totalBytes) {
      throw new Error(`Asset ${transport.id} was truncated: expected ${totalBytes} bytes, received ${written}`);
    }
    return written;
  } finally {
    await writable.close().catch((e: unknown) => {
      log.warn(`Failed to close the writable for ${transport.id}`, e);
    });
  }
}
