import { VIDEO_DIR_NAME, AUDIO_DIR_NAME, IMAGES_DIR_NAME } from '~/utils/constants';
import { randomToken } from '~/utils/ids';

export interface ExternalAsset {
  id?: string;
  url: string;
  type?: 'video' | 'audio' | 'image';
  filename?: string;
}

export interface ExternalAssetPlacement {
  type: 'video' | 'audio' | 'image';
  filename: string;
  /** Where the asset lands inside the project, e.g. `_video/clip.mp4`. */
  relativePath: string;
}

const EXTENSIONS_BY_TYPE: Record<'video' | 'audio' | 'image', string[]> = {
  video: ['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'],
  audio: ['mp3', 'wav', 'ogg', 'aac', 'flac', 'opus', 'm4a'],
  image: [],
};

const DIR_BY_TYPE = {
  video: VIDEO_DIR_NAME,
  audio: AUDIO_DIR_NAME,
  image: IMAGES_DIR_NAME,
} as const;

const DEFAULT_EXTENSION = { video: 'mp4', audio: 'mp3', image: 'png' } as const;

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/opus': 'opus',
  'audio/mp4': 'm4a',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

function inferType(filename: string | undefined, contentType: string | null | undefined) {
  if (contentType?.startsWith('video/')) return 'video';
  if (contentType?.startsWith('audio/')) return 'audio';
  if (contentType?.startsWith('image/')) return 'image';

  const ext = filename?.split('.').pop()?.toLowerCase() ?? '';
  if (EXTENSIONS_BY_TYPE.video.includes(ext)) return 'video';
  if (EXTENSIONS_BY_TYPE.audio.includes(ext)) return 'audio';
  return 'image';
}

function inferExtension(
  type: ExternalAssetPlacement['type'],
  contentType: string | null | undefined,
): string {
  const normalizedContentType = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  return (
    (normalizedContentType?.startsWith(`${type}/`) &&
      EXTENSION_BY_CONTENT_TYPE[normalizedContentType]) ||
    DEFAULT_EXTENSION[type]
  );
}

/**
 * Decides what an asset is and where it belongs in the project.
 *
 * The host's declared `type` wins; otherwise the server's content type decides,
 * and the file extension is the last resort. Kept separate from any fetching so
 * the destination can be resolved from a cheap header probe, before a byte of
 * the media itself is moved.
 */
export function resolveAssetPlacement(
  asset: ExternalAsset,
  contentType?: string | null,
): ExternalAssetPlacement {
  const urlFilename = asset.url.split('/').pop()?.split('?')[0];
  let filename = asset.filename || urlFilename;
  const type = asset.type ?? inferType(filename, contentType);

  if (!filename) {
    filename = `asset-${Date.now()}-${randomToken(7)}.${DEFAULT_EXTENSION[type]}`;
  }

  const storageFilename =
    asset.id !== undefined
      ? `${encodeURIComponent(asset.id)}.${inferExtension(type, contentType)}`
      : filename;

  return { type, filename, relativePath: `${DIR_BY_TYPE[type]}/${storageFilename}` };
}
