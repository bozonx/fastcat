import { ImageSource, Sprite, Texture } from 'pixi.js';
import type { HudMediaState } from './types';
import { RasterImageLoader } from './RasterImageLoader';

export interface HudMediaLoaderDeps {
  getFileHandleByPath: (path: string) => Promise<FileSystemFileHandle | null>;
  getFileByPath?: (path: string) => Promise<File | null>;
  getCurrentProjectId?: () => Promise<string | null>;
  ensureVectorImageRaster?: (params: {
    projectId: string;
    projectRelativePath: string;
    width: number;
    height: number;
    sourceFileHandle: FileSystemFileHandle;
  }) => Promise<FileSystemFileHandle | null>;
}

export interface HudMediaLoaderContext {
  width: number;
  height: number;
}

export class HudMediaLoader {
  constructor(private readonly context: HudMediaLoaderContext) {}

  public async loadImageState(params: {
    sourcePath?: string;
    deps: HudMediaLoaderDeps;
  }): Promise<HudMediaState | null> {
    const loaded = await new RasterImageLoader({
      width: this.context.width,
      height: this.context.height,
    }).load(params);
    if (!loaded || !params.sourcePath) {
      return null;
    }

    const imageSource = new ImageSource({ resource: loaded.bitmap as any });

    return {
      sourcePath: params.sourcePath,
      fileHandle: loaded.fileHandle,
      sourceDurationUs: 0,
      clipKind: 'image',
      sourceKind: 'bitmap',
      imageSource,
      sprite: new Sprite(new Texture({ source: imageSource })),
      lastVideoFrame: null,
      bitmap: loaded.bitmap,
    };
  }
}
