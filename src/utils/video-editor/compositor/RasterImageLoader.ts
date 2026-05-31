import { getMediaTypeFromFilename } from '../../media-types';
import { isSvgFile } from '../../svg';
import { runResilientWorkerFileIo } from '../../../workers/core/io-governor';
import type { VectorImageRasterCacheResult } from '../worker-client';

export interface RasterImageLoaderDeps {
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath?: (path: string) => Promise<File | null>;
  getCurrentProjectId?: () => Promise<string | null>;
  ensureVectorImageRaster?: (params: {
    projectId: string;
    projectRelativePath: string;
    width: number;
    height: number;
    sourceFileHandle: FileSystemFileHandle;
  }) => Promise<VectorImageRasterCacheResult | null>;
}

export interface RasterImageLoaderContext {
  width: number;
  height: number;
}

export interface LoadedRasterImage {
  bitmap: ImageBitmap;
  file: File;
  fileHandle: FileSystemFileHandle;
  width: number;
  height: number;
}

export class RasterImageLoader {
  constructor(private readonly context: RasterImageLoaderContext) {}

  public async load(params: {
    sourcePath?: string;
    deps: RasterImageLoaderDeps;
  }): Promise<LoadedRasterImage | null> {
    const { sourcePath, deps } = params;
    if (!sourcePath) {
      return null;
    }

    const fileHandle = await deps.getFileHandleByPath(sourcePath);
    if (!fileHandle) {
      return null;
    }

    const file =
      (await deps.getFileByPath?.(sourcePath)) ??
      (await runResilientWorkerFileIo(fileHandle, () => fileHandle.getFile()));
    const isImage =
      (typeof file?.type === 'string' && file.type.startsWith('image/')) ||
      getMediaTypeFromFilename(sourcePath) === 'image';

    if (!isImage) {
      return null;
    }

    let imageFile = file;
    if (
      isSvgFile({ file, path: sourcePath }) &&
      deps.getCurrentProjectId &&
      deps.ensureVectorImageRaster
    ) {
      const projectId = await deps.getCurrentProjectId();
      if (projectId) {
        const cached = await deps.ensureVectorImageRaster({
          projectId,
          projectRelativePath: sourcePath,
          width: this.context.width,
          height: this.context.height,
          sourceFileHandle: fileHandle,
        });
        if (cached) {
          imageFile =
            cached instanceof File
              ? cached
              : await runResilientWorkerFileIo(cached, () => cached.getFile());
        }
      }
    }

    const bitmap = await createImageBitmap(imageFile);
    const width = Math.max(1, Math.round(bitmap.width ?? 1));
    const height = Math.max(1, Math.round(bitmap.height ?? 1));

    return {
      bitmap,
      file: imageFile,
      fileHandle,
      width,
      height,
    };
  }
}
