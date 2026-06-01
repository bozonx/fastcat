export type MediaIoSourceKind = 'file' | 'vfs' | 'tauri-native';

export interface MediaIoSourceBase {
  kind: MediaIoSourceKind;
  sourceKey: string;
  name: string;
  size?: number;
  lastModified?: number;
}

export interface FileMediaIoSource extends MediaIoSourceBase {
  kind: 'file';
  file: File;
}

export interface VfsMediaIoSource extends MediaIoSourceBase {
  kind: 'vfs';
  vfsPath: string;
}

export interface TauriNativeMediaIoSource extends MediaIoSourceBase {
  kind: 'tauri-native';
  /**
   * Absolute filesystem path owned by the Tauri runtime. Future native
   * metadata, waveform, proxy and range-read commands should consume this path
   * instead of materializing large media files in the renderer.
   */
  nativePath: string;
}

export type MediaIoSource = FileMediaIoSource | VfsMediaIoSource | TauriNativeMediaIoSource;

export function createFileMediaIoSource(params: {
  sourceKey: string;
  file: File;
}): FileMediaIoSource {
  return {
    kind: 'file',
    sourceKey: params.sourceKey,
    name: params.file.name,
    size: params.file.size,
    lastModified: params.file.lastModified,
    file: params.file,
  };
}

export function createTauriNativeMediaIoSource(params: {
  sourceKey: string;
  nativePath: string;
  name: string;
  size?: number;
  lastModified?: number;
}): TauriNativeMediaIoSource {
  return {
    kind: 'tauri-native',
    sourceKey: params.sourceKey,
    nativePath: params.nativePath,
    name: params.name,
    size: params.size,
    lastModified: params.lastModified,
  };
}
