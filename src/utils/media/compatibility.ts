/**
 * Single source of truth for "can this media file be used?" decisions, shared by
 * the file browser (compatibility badges), the file-properties panel (unsupported
 * banners / convertibility) and the timeline command service (drop validation).
 *
 * Both the web and Tauri import pipelines normalize their probe results into the
 * same {@link MediaMetadata} shape (`video.canDecode`, `audio.canDecode`,
 * `image.canDisplay`, and a top-level `error` flag), so every consumer can reuse
 * the pure predicates below instead of re-deriving the rules. Previously each
 * call site reimplemented `canDecode === false` / `canDisplay === false` checks
 * and they had drifted apart; keep new rules here.
 */

import { BROWSER_NATIVE_IMAGE_EXTENSIONS, getMediaTypeFromFilename } from '~/utils/media-types';

export type FileCompatibilityStatus =
  | 'ok'
  | 'checking'
  | 'fully_unsupported'
  | 'audio_unsupported'
  | 'corrupt';

/**
 * Minimal structural view of the fields these decisions read. Kept loose so both
 * the store's strongly-typed `MediaMetadata` and the `Record<string, unknown>`
 * views used by the properties panel satisfy it without casts at the call site.
 */
export interface MediaCompatibilityMeta {
  error?: boolean;
  video?: { canDecode?: boolean } | null;
  audio?: { canDecode?: boolean } | null;
  image?: { canDisplay?: boolean } | null;
}

function track(value: unknown): { canDecode?: boolean; canDisplay?: boolean } | undefined {
  return (value ?? undefined) as { canDecode?: boolean; canDisplay?: boolean } | undefined;
}

/** Lower-cased extension (without dot) for a filename, or `''`. */
export function fileExtension(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/** A declared video track that failed decode validation. */
export function isVideoUndecodable(meta: MediaCompatibilityMeta | null | undefined): boolean {
  return track(meta?.video)?.canDecode === false;
}

/** A declared audio track that failed decode validation. */
export function isAudioUndecodable(meta: MediaCompatibilityMeta | null | undefined): boolean {
  return track(meta?.audio)?.canDecode === false;
}

/**
 * An image whose bytes could not be decoded for display. Only meaningful for
 * browser-native image extensions — non-native formats (e.g. tiff) are a
 * "format unsupported" condition, not corruption, and are surfaced separately by
 * {@link computeMediaCompatibilityStatus}.
 */
export function isImageUndisplayable(
  meta: MediaCompatibilityMeta | null | undefined,
  ext: string,
): boolean {
  return BROWSER_NATIVE_IMAGE_EXTENSIONS.includes(ext) && track(meta?.image)?.canDisplay === false;
}

export interface ComputeStatusInput {
  /** Probed metadata, or `undefined` when not yet loaded. */
  meta: MediaCompatibilityMeta | null | undefined;
  mediaType: 'video' | 'audio' | 'image';
  /** Lower-cased file extension (see {@link fileExtension}). */
  ext: string;
  /** A persisted/permanent extraction failure (the `error` flag was recorded). */
  isFailed: boolean;
  /** Extraction is currently in flight. */
  isLoading: boolean;
  /**
   * Source whose metadata is fetched lazily/optimistically (remote or external
   * absolute paths): when nothing is known yet, assume `ok` rather than spinning
   * on `checking` forever.
   */
  treatUnknownAsOk: boolean;
}

/**
 * Classify a media file into a single compatibility status. The order matters:
 * a hard extraction failure (`error`) outranks codec-level findings.
 */
export function computeMediaCompatibilityStatus(
  input: ComputeStatusInput,
): FileCompatibilityStatus {
  const { meta, mediaType, ext, isFailed, isLoading, treatUnknownAsOk } = input;

  if (meta?.error || isFailed) return 'corrupt';

  if (!meta) {
    if (isLoading) return 'checking';
    return treatUnknownAsOk ? 'ok' : 'checking';
  }

  if (mediaType === 'image') {
    const canDisplay = track(meta.image)?.canDisplay;
    if (canDisplay === false) {
      return BROWSER_NATIVE_IMAGE_EXTENSIONS.includes(ext) ? 'corrupt' : 'fully_unsupported';
    }
    return 'ok';
  }

  if (mediaType === 'video') {
    if (isVideoUndecodable(meta)) return 'fully_unsupported';
    if (isAudioUndecodable(meta)) return 'audio_unsupported';
    return 'ok';
  }

  // audio
  if (isAudioUndecodable(meta)) return 'fully_unsupported';
  return 'ok';
}

export function checkFileTimelineCompatibility(
  entry: { kind?: string; name: string; path?: string },
  mediaStore: {
    metadataLoadFailed: Record<string, boolean>;
    mediaMetadata: Record<string, any>;
  }
): { compatible: boolean; reasonKey: string | null } {
  if (entry.kind === 'directory') {
    return {
      compatible: false,
      reasonKey: 'videoEditor.fileManager.compatibility.folderUnsupportedForTimeline',
    };
  }

  const mediaType = getMediaTypeFromFilename(entry.name);
  if (mediaType !== 'video' && mediaType !== 'audio' && mediaType !== 'image' && mediaType !== 'text') {
    return {
      compatible: false,
      reasonKey: 'videoEditor.fileManager.compatibility.formatUnsupported',
    };
  }

  if (entry.path) {
    const isRemote = entry.path.startsWith('/remote') || (entry as any).source === 'remote';
    const isExternal = entry.path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entry.path);
    const cacheKey = (isRemote || isExternal) ? `external:${entry.path}` : entry.path;

    if (mediaStore?.metadataLoadFailed?.[cacheKey]) {
      return {
        compatible: false,
        reasonKey: 'videoEditor.fileManager.compatibility.corrupt',
      };
    }

    const meta = mediaStore?.mediaMetadata?.[cacheKey];
    if (meta) {
      if (meta.error) {
        return {
          compatible: false,
          reasonKey: 'videoEditor.fileManager.compatibility.corrupt',
        };
      }
      if (mediaType === 'image') {
        const ext = entry.name.split('.').pop()?.toLowerCase() ?? '';
        const BROWSER_NATIVE_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
        if (meta.image?.canDisplay === false) {
          return {
            compatible: false,
            reasonKey: BROWSER_NATIVE_IMAGE_EXTENSIONS.includes(ext)
              ? 'videoEditor.fileManager.compatibility.corrupt'
              : 'videoEditor.fileManager.compatibility.formatUnsupported',
          };
        }
      } else if (mediaType === 'video') {
        if (meta.video?.canDecode === false) {
          return {
            compatible: false,
            reasonKey: 'videoEditor.fileManager.compatibility.videoCodecUnsupported',
          };
        }
        if (meta.audio?.canDecode === false) {
          return {
            compatible: false,
            reasonKey: 'videoEditor.fileManager.compatibility.audioCodecUnsupported',
          };
        }
      } else if (mediaType === 'audio') {
        if (meta.audio?.canDecode === false) {
          return {
            compatible: false,
            reasonKey: 'videoEditor.fileManager.compatibility.audioCodecUnsupported',
          };
        }
      }
    }
  }

  return { compatible: true, reasonKey: null };
}
