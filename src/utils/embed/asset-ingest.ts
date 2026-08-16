import { createDevLogger } from '~/utils/dev-logger';
import { runResilientFileWrite } from '~/utils/io/io-governor';
import type { EmbedAssetTransport } from './asset-transport';

const log = createDevLogger('embed-asset-ingest');

/** Bytes pulled per network round trip while materialising an asset. */
const DOWNLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

export interface EmbedAssetMetadata {
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

/**
 * Reads an asset's duration and dimensions straight off the network, without
 * materialising the file first.
 *
 * This is what lets the editor open with the clips already on the timeline
 * instead of a spinner: a container's header and index are a tiny fraction of
 * a video, and Mediabunny's `CustomSource` fetches exactly the ranges it needs
 * to parse them. A full download would gate the first frame on the whole file.
 */
export async function probeAssetMetadata(
  transport: EmbedAssetTransport,
): Promise<EmbedAssetMetadata | null> {
  const size = await transport.getSize();
  if (!size) {
    log.warn(`Asset ${transport.id} has no known size; skipping the metadata probe`);
    return null;
  }

  const { Input, CustomSource, ALL_FORMATS } = await import('mediabunny');

  const source = new CustomSource({
    getSize: () => size,
    read: (start, end) => transport.readRange(start, end),
    // Reads here are network round trips, so let Mediabunny batch them
    // aggressively rather than issuing one request per structure it parses.
    prefetchProfile: 'network',
  });

  const input = new Input({ source, formats: ALL_FORMATS });
  try {
    const durationSec = await input.computeDuration().catch(() => null);
    const videoTrack = await input.getPrimaryVideoTrack().catch(() => null);

    return {
      durationSec: Number.isFinite(durationSec) ? (durationSec as number) : null,
      width: videoTrack?.displayWidth ?? null,
      height: videoTrack?.displayHeight ?? null,
    };
  } catch (e) {
    log.warn(`Failed to probe metadata for ${transport.id}`, e);
    return null;
  } finally {
    try {
      await input.dispose();
    } catch {
      // Disposal failures are not worth surfacing over a metadata probe.
    }
  }
}

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

    return written;
  } finally {
    await writable.close().catch((e: unknown) => {
      log.warn(`Failed to close the writable for ${transport.id}`, e);
    });
  }
}
