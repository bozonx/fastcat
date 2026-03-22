import { CanvasSource, Graphics, ImageSource, Sprite, Texture, type Container } from 'pixi.js';
import type { LayoutApplier } from './LayoutApplier';
import type { CompositorClip, CompositorTrack } from './types';

export interface CreateClipBaseParams {
  itemId: string;
  trackId?: string;
  layer: number;
  startUs: number;
  endUs: number;
  durationUs: number;
  sourceStartUs: number;
  sourceRangeDurationUs: number;
  sourceDurationUs: number;
  speed?: number;
  opacity?: number;
  blendMode?: CompositorClip['blendMode'];
  effects?: CompositorClip['effects'];
  transform?: CompositorClip['transform'];
  transitionIn?: CompositorClip['transitionIn'];
  transitionOut?: CompositorClip['transitionOut'];
}

export interface ClipFactoryContext {
  width: number;
  height: number;
  layoutApplier: LayoutApplier;
}

export class ClipFactory {
  constructor(private readonly context: ClipFactoryContext) {}

  public createSolidClip(
    params: CreateClipBaseParams & {
      backgroundColor: string;
      clipType: 'background';
    },
  ): CompositorClip {
    const sprite = new Sprite(Texture.WHITE);
    sprite.width = 1;
    sprite.height = 1;
    sprite.visible = false;
    (sprite as any).__clipId = params.itemId;

    const clip: CompositorClip = {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      startUs: params.startUs,
      endUs: params.endUs,
      durationUs: params.durationUs,
      sourceStartUs: params.sourceStartUs,
      sourceRangeDurationUs: params.sourceRangeDurationUs,
      sourceDurationUs: params.sourceDurationUs,
      speed: params.speed,
      sprite,
      clipType: params.clipType,
      clipKind: 'solid',
      sourceKind: 'bitmap',
      imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }),
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      backgroundColor: params.backgroundColor,
      opacity: params.opacity,
      blendMode: params.blendMode,
      effects: params.effects,
      transform: params.transform,
    };

    this.context.layoutApplier.applySolidLayout(clip);

    return clip;
  }

  public createTextClip(
    params: CreateClipBaseParams & {
      text: string;
      style: CompositorClip['style'];
    },
  ): CompositorClip {
    const sprite = new Sprite(Texture.EMPTY);
    sprite.visible = false;
    (sprite as any).__clipId = params.itemId;

    return {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      startUs: params.startUs,
      endUs: params.endUs,
      durationUs: params.durationUs,
      sourceStartUs: params.sourceStartUs,
      sourceRangeDurationUs: params.sourceRangeDurationUs,
      sourceDurationUs: params.sourceDurationUs,
      speed: params.speed,
      sprite,
      clipType: 'text',
      clipKind: 'text',
      sourceKind: 'canvas',
      imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }),
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      text: params.text,
      style: params.style,
      opacity: params.opacity,
      blendMode: params.blendMode,
      effects: params.effects,
      transform: params.transform,
      transitionIn: params.transitionIn,
      transitionOut: params.transitionOut,
      transitionFilter: null,
      transitionFilterType: null,
      textDirty: true,
    };
  }

  public createShapeClip(
    params: CreateClipBaseParams & {
      shapeType: NonNullable<CompositorClip['shapeType']>;
      fillColor: string;
      strokeColor: string;
      strokeWidth: number;
    },
  ): CompositorClip {
    const sprite = new Graphics();
    sprite.visible = false;
    (sprite as any).__clipId = params.itemId;

    const clip: CompositorClip = {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      startUs: params.startUs,
      endUs: params.endUs,
      durationUs: params.durationUs,
      sourceStartUs: params.sourceStartUs,
      sourceRangeDurationUs: params.sourceRangeDurationUs,
      sourceDurationUs: params.sourceDurationUs,
      speed: params.speed,
      sprite,
      clipType: 'shape',
      clipKind: 'shape',
      sourceKind: 'graphics',
      imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }),
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      shapeType: params.shapeType,
      fillColor: params.fillColor,
      strokeColor: params.strokeColor,
      strokeWidth: params.strokeWidth,
      opacity: params.opacity,
      blendMode: params.blendMode,
      effects: params.effects,
      transform: params.transform,
      transitionIn: params.transitionIn,
      transitionOut: params.transitionOut,
      transitionFilter: null,
      transitionFilterType: null,
      shapeDirty: true,
    };

    this.context.layoutApplier.applyShapeLayout(clip);

    return clip;
  }

  public createAdjustmentClip(params: CreateClipBaseParams): CompositorClip {
    const sprite = new Sprite(Texture.EMPTY);
    sprite.width = this.context.width;
    sprite.height = this.context.height;
    sprite.visible = false;
    (sprite as any).__clipId = params.itemId;

    return {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      startUs: params.startUs,
      endUs: params.endUs,
      durationUs: params.durationUs,
      sourceStartUs: params.sourceStartUs,
      sourceRangeDurationUs: params.sourceRangeDurationUs,
      sourceDurationUs: params.sourceDurationUs,
      speed: params.speed,
      sprite,
      clipType: 'adjustment',
      clipKind: 'adjustment',
      sourceKind: 'bitmap',
      imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }),
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      opacity: params.opacity,
      blendMode: params.blendMode,
      effects: params.effects,
      transform: params.transform,
      adjustmentSourceTexture: null,
    };
  }

  public createHudClip(
    params: CreateClipBaseParams & {
      hudType: NonNullable<CompositorClip['hudType']>;
      background: CompositorClip['background'];
      content: CompositorClip['content'];
    },
  ): CompositorClip {
    const sprite = new Sprite(Texture.EMPTY);
    sprite.width = this.context.width;
    sprite.height = this.context.height;
    sprite.visible = false;
    (sprite as any).__clipId = params.itemId;

    const clip: CompositorClip = {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      startUs: params.startUs,
      endUs: params.endUs,
      durationUs: params.durationUs,
      sourceStartUs: params.sourceStartUs,
      sourceRangeDurationUs: params.sourceRangeDurationUs,
      sourceDurationUs: params.sourceDurationUs,
      speed: params.speed,
      sprite,
      clipType: 'hud',
      clipKind: 'hud',
      sourceKind: 'bitmap',
      imageSource: new ImageSource({ resource: new OffscreenCanvas(2, 2) as any }),
      lastVideoFrame: null,
      canvas: new OffscreenCanvas(this.context.width, this.context.height),
      ctx: null,
      bitmap: null,
      hudType: params.hudType,
      background: params.background,
      content: params.content,
      opacity: params.opacity,
      blendMode: params.blendMode,
      effects: params.effects,
      transform: params.transform,
      transitionIn: params.transitionIn,
      transitionOut: params.transitionOut,
      transitionFilter: null,
      transitionFilterType: null,
      hudDirty: true,
      hudMediaStates: {},
    };

    const ctx = clip.canvas?.getContext('2d');
    if (ctx) {
      clip.ctx = ctx as OffscreenCanvasRenderingContext2D;
      const canvasSource = new CanvasSource({ resource: clip.canvas as any });
      sprite.texture.source = canvasSource as any;
    }

    return clip;
  }

  public createImageClip(
    params: CreateClipBaseParams & {
      sourcePath: string;
      fileHandle: FileSystemFileHandle;
      bitmap: ImageBitmap | null;
      imageSource: ImageSource;
    },
  ): CompositorClip {
    const texture = new Texture({ source: params.imageSource });
    const sprite = new Sprite(texture);
    sprite.width = 1;
    sprite.height = 1;
    sprite.visible = false;
    (sprite as any).__clipId = params.itemId;

    return {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      sourcePath: params.sourcePath,
      fileHandle: params.fileHandle,
      startUs: params.startUs,
      endUs: params.endUs,
      durationUs: params.durationUs,
      sourceStartUs: params.sourceStartUs,
      sourceRangeDurationUs: params.sourceRangeDurationUs,
      sourceDurationUs: params.sourceDurationUs,
      speed: params.speed,
      sprite,
      clipKind: 'image',
      sourceKind: 'bitmap',
      imageSource: params.imageSource,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: params.bitmap,
      backgroundColor: undefined,
      opacity: params.opacity,
      blendMode: params.blendMode,
      effects: params.effects,
      transform: params.transform,
      transitionIn: params.transitionIn,
      transitionOut: params.transitionOut,
    };
  }

  public createVideoClip(
    params: CreateClipBaseParams & {
      sourcePath: string;
      fileHandle: FileSystemFileHandle;
      input: CompositorClip['input'];
      sink: CompositorClip['sink'];
      firstTimestampS?: number;
      frameRate?: number;
      freezeFrameSourceUs?: number;
      imageSource: ImageSource;
    },
  ): CompositorClip {
    const texture = new Texture({ source: params.imageSource });
    const sprite = new Sprite(texture);
    sprite.width = 1;
    sprite.height = 1;
    sprite.visible = false;
    (sprite as any).__clipId = params.itemId;

    return {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      sourcePath: params.sourcePath,
      fileHandle: params.fileHandle,
      input: params.input,
      sink: params.sink,
      firstTimestampS: params.firstTimestampS,
      frameRate: params.frameRate,
      startUs: params.startUs,
      endUs: params.endUs,
      durationUs: params.durationUs,
      sourceStartUs: params.sourceStartUs,
      sourceRangeDurationUs: params.sourceRangeDurationUs,
      sourceDurationUs: params.sourceDurationUs,
      speed: params.speed,
      freezeFrameSourceUs: params.freezeFrameSourceUs,
      sprite,
      clipKind: 'video',
      sourceKind: 'videoFrame',
      imageSource: params.imageSource,
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      backgroundColor: undefined,
      opacity: params.opacity,
      blendMode: params.blendMode,
      effects: params.effects,
      transform: params.transform,
      transitionIn: params.transitionIn,
      transitionOut: params.transitionOut,
    };
  }

  public attachClipSprite(params: {
    clip: CompositorClip;
    trackRuntime: CompositorTrack | null;
    stage: Container;
  }) {
    if (params.trackRuntime) {
      params.trackRuntime.container.addChild(params.clip.sprite as any);
      return;
    }

    params.stage.addChild(params.clip.sprite as any);
  }
}
