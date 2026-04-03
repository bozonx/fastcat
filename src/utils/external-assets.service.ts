import { 
  VIDEO_DIR_NAME, 
  AUDIO_DIR_NAME, 
  IMAGES_DIR_NAME, 
} from '~/utils/constants';

export interface ExternalAsset {
  id?: string;
  url: string;
  type?: 'video' | 'audio' | 'image';
  filename?: string;
}

export interface AssetLoadResult {
  asset: ExternalAsset;
  path: string;
  success: boolean;
  error?: string;
}

/**
 * Service to load external assets into the project's OPFS storage.
 */
export async function loadExternalAssets(params: {
  assets: ExternalAsset[];
  getProjectFileHandle: (path: string, options: { create: boolean }) => Promise<FileSystemFileHandle | null>;
}): Promise<AssetLoadResult[]> {
  const promises = params.assets.map(async (asset) => {
    try {
      const response = await fetch(asset.url);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const blob = await response.blob();
      const contentType = response.headers.get('Content-Type');

      // 1. Resolve filename
      let filename = asset.filename || asset.url.split('/').pop()?.split('?')[0];
      
      // 2. Resolve content type and folder
      let resolvedType = asset.type;
      if (!resolvedType) {
        if (contentType?.startsWith('video/')) resolvedType = 'video';
        else if (contentType?.startsWith('audio/')) resolvedType = 'audio';
        else if (contentType?.startsWith('image/')) resolvedType = 'image';
        else {
          // Fallback to extension if Content-Type is missing or generic
          const ext = filename?.split('.').pop()?.toLowerCase();
          if (['mp4', 'webm', 'mov'].includes(ext || '')) resolvedType = 'video';
          else if (['mp3', 'wav', 'ogg', 'aac'].includes(ext || '')) resolvedType = 'audio';
          else resolvedType = 'image'; // default fallback
        }
      }

      const folder = resolvedType === 'video' ? VIDEO_DIR_NAME : 
                     resolvedType === 'audio' ? AUDIO_DIR_NAME : 
                     IMAGES_DIR_NAME;
      
      if (!filename) {
        filename = `asset-${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${resolvedType === 'image' ? 'png' : resolvedType === 'video' ? 'mp4' : 'mp3'}`;
      }

      const relativePath = `${folder}/${filename}`;

      const handle = await params.getProjectFileHandle(relativePath, { create: true });
      if (!handle) throw new Error(`Failed to get file handle for ${relativePath}`);

      const writable = await (handle as any).createWritable();
      await writable.write(blob);
      await writable.close();

      return {
        asset: { ...asset, id: asset.id || filename, type: resolvedType, filename },
        path: relativePath,
        success: true
      };
    } catch (e) {
      console.error(`Failed to load asset ${asset.url}:`, e);
      return {
        asset,
        path: '',
        success: false,
        error: e instanceof Error ? e.message : String(e)
      };
    }
  });

  return Promise.all(promises);
}
