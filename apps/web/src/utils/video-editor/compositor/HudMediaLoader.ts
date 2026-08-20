import { ImageSource, Sprite, Texture } from 'pixi.js';
import type { HudMediaState } from './types';
import { RasterImageLoader, type MediaSourceLoaderDeps } from './RasterImageLoader';

export type HudMediaLoaderDeps = MediaSourceLoaderDeps;

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

    const imageSource = new ImageSource({ resource: loaded.bitmap });
    imageSource.update();

    return {
      sourcePath: params.sourcePath,
      fileHandle: loaded.fileHandle,
      sourceDurationTicks: 0,
      clipKind: 'image',
      sourceKind: 'bitmap',
      imageSource,
      sprite: new Sprite(new Texture({ source: imageSource, dynamic: true })),
      lastVideoFrame: null,
      bitmap: loaded.bitmap,
    };
  }
}
