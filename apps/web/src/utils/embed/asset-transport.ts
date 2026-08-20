import { createDevLogger } from '~/utils/dev-logger';
import { withFileIoSlot } from '~/utils/io/io-governor';

const log = createDevLogger('embed-asset-transport');

/** Statuses that mean "this URL is no longer valid", not "this asset is gone". */
const EXPIRED_STATUSES = new Set([401, 403, 410]);

export interface EmbedAssetTransport {
  readonly id: string;
  /** Total size in bytes, or null when the server refuses to say. */
  getSize: () => Promise<number | null>;
  getContentType: () => Promise<string | null>;
  readRange: (start: number, endExclusive: number) => Promise<Uint8Array>;
  dispose: () => void;
}

export interface UrlTransportOptions {
  id: string;
  url: string;
  /**
   * Resolves a fresh URL after the current one expires. Sessions outlive short
   * signed URLs — a long export on a big timeline easily outlasts a one-hour
   * token — so a transport that could not re-ask the host would strand the user
   * mid-render.
   */
  requestFreshUrl?: (assetId: string) => Promise<string>;
  signal?: AbortSignal;
}

function isExpiredResponse(response: Response): boolean {
  return EXPIRED_STATUSES.has(response.status);
}

/**
 * Reads an asset over HTTP range requests.
 *
 * Reading straight from the network rather than proxying bytes through the host
 * keeps every read one round trip: seeking a timeline issues thousands of small
 * reads, and each one bounced through `postMessage` would pay for an extra hop
 * plus a copy, from a worker that cannot even talk to the host directly.
 */
export function createUrlTransport(options: UrlTransportOptions): EmbedAssetTransport {
  let currentUrl = options.url;
  let cachedSize: number | null | undefined;
  let cachedContentType: string | null | undefined;
  // Servers that ignore Range must be read once, not once per requested chunk.
  let completeResponse: Uint8Array | null = null;
  let refreshInFlight: Promise<string> | null = null;

  async function refreshUrl(): Promise<boolean> {
    if (!options.requestFreshUrl) return false;

    // Concurrent reads all hit the expiry at once; they must share one refresh.
    refreshInFlight ??= options.requestFreshUrl(options.id).finally(() => {
      refreshInFlight = null;
    });

    try {
      currentUrl = await refreshInFlight;
      return true;
    } catch (e) {
      log.warn(`Failed to refresh the URL for asset ${options.id}`, e);
      return false;
    }
  }

  async function fetchWithRefresh(init: RequestInit): Promise<Response> {
    const response = await withFileIoSlot(() =>
      fetch(currentUrl, { ...init, signal: options.signal }),
    );
    if (!isExpiredResponse(response)) return response;
    if (!(await refreshUrl())) return response;
    return withFileIoSlot(() => fetch(currentUrl, { ...init, signal: options.signal }));
  }

  return {
    id: options.id,

    async getSize() {
      if (cachedSize !== undefined) return cachedSize;

      // A one-byte range answers the size question on servers that reject HEAD,
      // and confirms range support at the same time.
      const response = await fetchWithRefresh({ headers: { Range: 'bytes=0-0' } });
      if (!response.ok && response.status !== 206) {
        throw new Error(`Failed to probe ${options.id}: HTTP ${response.status}`);
      }

      const contentRange = response.headers.get('Content-Range');
      cachedContentType = response.headers.get('Content-Type')?.split(';')[0]?.trim() || null;
      const total = contentRange?.split('/')[1];
      cachedSize = total && total !== '*' ? Number(total) : null;

      if (cachedSize === null) {
        const length = response.headers.get('Content-Length');
        // Without `Content-Range` a 200 means the server ignored the range and
        // sent the whole body, so `Content-Length` is the real size.
        cachedSize = response.status === 200 && length ? Number(length) : null;
      }

      if (response.status === 200) {
        completeResponse = new Uint8Array(await response.arrayBuffer());
        if (cachedSize !== null && completeResponse.byteLength !== cachedSize) {
          throw new Error(`Truncated response while probing ${options.id}`);
        }
        cachedSize = completeResponse.byteLength;
      } else {
        void response.body?.cancel();
      }
      return cachedSize;
    },

    async getContentType() {
      if (cachedContentType === undefined) await this.getSize();
      return cachedContentType ?? null;
    },

    async readRange(start, endExclusive) {
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endExclusive) || start < 0 || endExclusive < start) {
        throw new Error(`Invalid byte range for ${options.id}`);
      }
      if (completeResponse) {
        if (endExclusive > completeResponse.byteLength) throw new Error(`Range exceeds ${options.id} length`);
        return completeResponse.subarray(start, endExclusive);
      }
      const response = await fetchWithRefresh({
        headers: { Range: `bytes=${start}-${endExclusive - 1}` },
      });
      if (!response.ok && response.status !== 206) {
        throw new Error(
          `Failed to read ${options.id} bytes ${start}-${endExclusive}: HTTP ${response.status}`,
        );
      }

      const buffer = new Uint8Array(await response.arrayBuffer());
      const expectedLength = endExclusive - start;
      if (response.status === 200) {
        // Keep the one full response as the streaming fallback. This prevents
        // a range-blind server from causing a full re-download per chunk.
        completeResponse = buffer;
        if (endExclusive > buffer.byteLength) throw new Error(`Truncated response for ${options.id}`);
        return buffer.subarray(start, endExclusive);
      }
      if (buffer.byteLength !== expectedLength) throw new Error(`Short range response for ${options.id}`);
      return buffer;
    },

    dispose() {
      cachedSize = undefined;
      cachedContentType = undefined;
      completeResponse = null;
    },
  };
}

/**
 * Reads an asset the host handed over as a `File`.
 *
 * The fallback for hosts that cannot expose a CORS-capable signed URL, and the
 * efficient path when the user just picked the file on the host's side — a
 * `File` crosses by reference to its backing store, so re-fetching it over the
 * network would be strictly worse.
 */
export function createFileTransport(id: string, file: File): EmbedAssetTransport {
  return {
    id,
    getSize: () => Promise.resolve(file.size),
    getContentType: () => Promise.resolve(file.type || null),
    async readRange(start, endExclusive) {
      return new Uint8Array(await file.slice(start, endExclusive).arrayBuffer());
    },
    dispose() {},
  };
}
