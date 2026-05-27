import { CanvasFallbackRenderer } from './renderers/CanvasFallbackRenderer';
import { ShapeRenderer } from './renderers/ShapeRenderer';
import { TextRenderer } from './renderers/TextRenderer';
import { ClipFactory } from './ClipFactory';
import { ClipResourceManager } from './ClipResourceManager';
import { FrameSampleOrchestrator } from './FrameSampleOrchestrator';
import { HudMediaLoader } from './HudMediaLoader';
import { LayoutApplier } from './LayoutApplier';
import { MediaClipLoader } from './MediaClipLoader';
import { RasterImageLoader } from './RasterImageLoader';
import type { ResourceManager } from './ResourceManager';
import { TimelineActiveClipProcessor } from './TimelineActiveClipProcessor';
import { TimelineApplyLifecycle } from './TimelineApplyLifecycle';
import { TimelineClipAssetLoader } from './TimelineClipAssetLoader';
import { TimelineClipLayoutUpdater } from './TimelineClipLayoutUpdater';
import { TimelineClipLoader } from './TimelineClipLoader';
import { TimelineLayoutOrchestrator } from './TimelineLayoutOrchestrator';
import { TimelineLoadOrchestrator } from './TimelineLoadOrchestrator';
import { TimelineTrackRebinder } from './TimelineTrackRebinder';
import { TimelineUpdateLifecycle } from './TimelineUpdateLifecycle';
import type { VideoFrameCache } from './VideoFrameCache';

export interface CompositorRuntimeFactoryParams {
  width: number;
  height: number;
  clipPreferBitmapFallback: Map<string, boolean>;
  resourceManager: ResourceManager;
  videoFrameCache: VideoFrameCache;
}

export interface CompositorRuntime {
  layoutApplier: LayoutApplier;
  textRenderer: TextRenderer;
  shapeRenderer: ShapeRenderer;
  canvasFallbackRenderer: CanvasFallbackRenderer;
  timelineClipLoader: TimelineClipLoader;
  hudMediaLoader: HudMediaLoader;
  mediaClipLoader: MediaClipLoader;
  rasterImageLoader: RasterImageLoader;
  clipFactory: ClipFactory;
  timelineClipAssetLoader: TimelineClipAssetLoader;
  timelineLoadOrchestrator: TimelineLoadOrchestrator;
  timelineActiveClipProcessor: TimelineActiveClipProcessor;
  timelineApplyLifecycle: TimelineApplyLifecycle;
  timelineClipLayoutUpdater: TimelineClipLayoutUpdater;
  timelineTrackRebinder: TimelineTrackRebinder;
  timelineUpdateLifecycle: TimelineUpdateLifecycle;
  timelineLayoutOrchestrator: TimelineLayoutOrchestrator;
  frameSampleOrchestrator: FrameSampleOrchestrator;
  clipResourceManager: ClipResourceManager;
}

export function createCompositorRuntime(params: CompositorRuntimeFactoryParams): CompositorRuntime {
  const { width, height, clipPreferBitmapFallback, resourceManager, videoFrameCache } = params;
  const layoutApplier = new LayoutApplier({ width, height });
  const textRenderer = new TextRenderer();
  const shapeRenderer = new ShapeRenderer();
  const canvasFallbackRenderer = new CanvasFallbackRenderer({
    width,
    height,
    layoutApplier,
    clipPreferBitmapFallback,
  });
  const timelineClipLoader = new TimelineClipLoader();
  const hudMediaLoader = new HudMediaLoader({ width, height });
  const mediaClipLoader = new MediaClipLoader();
  const rasterImageLoader = new RasterImageLoader({ width, height });
  const clipFactory = new ClipFactory({
    width,
    height,
    layoutApplier,
  });
  const timelineClipAssetLoader = new TimelineClipAssetLoader({
    clipFactory,
    hudMediaLoader,
    mediaClipLoader,
  });
  const timelineLoadOrchestrator = new TimelineLoadOrchestrator({
    timelineClipLoader,
    timelineClipAssetLoader,
    clipFactory,
    layoutApplier,
    mediaClipLoader,
    rasterImageLoader,
  });

  return {
    layoutApplier,
    textRenderer,
    shapeRenderer,
    canvasFallbackRenderer,
    timelineClipLoader,
    hudMediaLoader,
    mediaClipLoader,
    rasterImageLoader,
    clipFactory,
    timelineClipAssetLoader,
    timelineLoadOrchestrator,
    timelineActiveClipProcessor: new TimelineActiveClipProcessor(),
    timelineApplyLifecycle: new TimelineApplyLifecycle(),
    timelineClipLayoutUpdater: new TimelineClipLayoutUpdater(),
    timelineTrackRebinder: new TimelineTrackRebinder(),
    timelineUpdateLifecycle: new TimelineUpdateLifecycle(),
    timelineLayoutOrchestrator: new TimelineLayoutOrchestrator(),
    frameSampleOrchestrator: new FrameSampleOrchestrator(),
    clipResourceManager: new ClipResourceManager({
      width,
      height,
      resourceManager,
      videoFrameCache,
      canvasFallbackRenderer,
      getLayoutApplier: () => layoutApplier,
    }),
  };
}
