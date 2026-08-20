import { CanvasSource, Graphics, Sprite, Texture, type Container, type ImageSource } from 'pixi.js';
import type { LayoutApplier } from './LayoutApplier';
import type { CompositorClip, CompositorTrack } from './types';
import { createPlaceholderImageSource, createSolidColorTexture } from './placeholderImageSource';

export interface CreateClipBaseParams {
  itemId: string;
  trackId?: string;
  layer: number;
  startTicks: number;
  endTicks: number;
  durationTicks: number;
  sourceStartTicks: number;
  sourceRangeDurationTicks: number;
  sourceDurationTicks: number;
  speed?: number;
  opacity?: number;
  blendMode?: CompositorClip['blendMode'];
  effects?: CompositorClip['effects'];
  transform?: CompositorClip['transform'];
  sourceOrientation?: CompositorClip['sourceOrientation'];
  transitionIn?: CompositorClip['transitionIn'];
  transitionOut?: CompositorClip['transitionOut'];
  mask?: CompositorClip['mask'];
  snapToPixelGrid?: boolean;
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
    const sprite = new Sprite(createSolidColorTexture('#ffffff'));
    sprite.width = 1;
    sprite.height = 1;
    sprite.visible = false;
    (sprite as { __clipId?: string }).__clipId = params.itemId;

    const clip: CompositorClip = {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      startTicks: params.startTicks,
      endTicks: params.endTicks,
      durationTicks: params.durationTicks,
      sourceStartTicks: params.sourceStartTicks,
      sourceRangeDurationTicks: params.sourceRangeDurationTicks,
      sourceDurationTicks: params.sourceDurationTicks,
      speed: params.speed,
      sprite,
      clipType: params.clipType,
      clipKind: 'solid',
      sourceKind: 'bitmap',
      imageSource: createPlaceholderImageSource(),
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      backgroundColor: params.backgroundColor,
      opacity: params.opacity,
      blendMode: params.blendMode,
      effects: params.effects,
      transform: params.transform,
      sourceOrientation: params.sourceOrientation,
      mask: params.mask,
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
    (sprite as { __clipId?: string }).__clipId = params.itemId;

    return {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      startTicks: params.startTicks,
      endTicks: params.endTicks,
      durationTicks: params.durationTicks,
      sourceStartTicks: params.sourceStartTicks,
      sourceRangeDurationTicks: params.sourceRangeDurationTicks,
      sourceDurationTicks: params.sourceDurationTicks,
      speed: params.speed,
      sprite,
      clipType: 'text',
      clipKind: 'text',
      sourceKind: 'canvas',
      imageSource: createPlaceholderImageSource(),
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
      sourceOrientation: params.sourceOrientation,
      transitionIn: params.transitionIn,
      transitionOut: params.transitionOut,
      mask: params.mask,
      snapToPixelGrid: params.snapToPixelGrid,
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
    (sprite as { __clipId?: string }).__clipId = params.itemId;

    const clip: CompositorClip = {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      startTicks: params.startTicks,
      endTicks: params.endTicks,
      durationTicks: params.durationTicks,
      sourceStartTicks: params.sourceStartTicks,
      sourceRangeDurationTicks: params.sourceRangeDurationTicks,
      sourceDurationTicks: params.sourceDurationTicks,
      speed: params.speed,
      sprite,
      clipType: 'shape',
      clipKind: 'shape',
      sourceKind: 'graphics',
      imageSource: createPlaceholderImageSource(),
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
      sourceOrientation: params.sourceOrientation,
      transitionIn: params.transitionIn,
      transitionOut: params.transitionOut,
      mask: params.mask,
      snapToPixelGrid: params.snapToPixelGrid,
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
    (sprite as { __clipId?: string }).__clipId = params.itemId;

    return {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      startTicks: params.startTicks,
      endTicks: params.endTicks,
      durationTicks: params.durationTicks,
      sourceStartTicks: params.sourceStartTicks,
      sourceRangeDurationTicks: params.sourceRangeDurationTicks,
      sourceDurationTicks: params.sourceDurationTicks,
      speed: params.speed,
      sprite,
      clipType: 'adjustment',
      clipKind: 'adjustment',
      sourceKind: 'bitmap',
      imageSource: createPlaceholderImageSource(),
      lastVideoFrame: null,
      canvas: null,
      ctx: null,
      bitmap: null,
      opacity: params.opacity,
      blendMode: params.blendMode,
      effects: params.effects,
      transform: params.transform,
      sourceOrientation: params.sourceOrientation,
      mask: params.mask,
      adjustmentSourceTexture: null,
    };
  }

  public createHudClip(
    params: CreateClipBaseParams & {
      hudType: NonNullable<CompositorClip['hudType']>;
      background: CompositorClip['background'];
      content: CompositorClip['content'];
      frame: CompositorClip['frame'];
    },
  ): CompositorClip {
    const sprite = new Sprite(Texture.EMPTY);
    sprite.width = this.context.width;
    sprite.height = this.context.height;
    sprite.visible = false;
    (sprite as { __clipId?: string }).__clipId = params.itemId;

    const clip: CompositorClip = {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      startTicks: params.startTicks,
      endTicks: params.endTicks,
      durationTicks: params.durationTicks,
      sourceStartTicks: params.sourceStartTicks,
      sourceRangeDurationTicks: params.sourceRangeDurationTicks,
      sourceDurationTicks: params.sourceDurationTicks,
      speed: params.speed,
      sprite,
      clipType: 'hud',
      clipKind: 'hud',
      sourceKind: 'bitmap',
      imageSource: createPlaceholderImageSource(),
      lastVideoFrame: null,
      canvas: new OffscreenCanvas(this.context.width, this.context.height),
      ctx: null,
      bitmap: null,
      hudType: params.hudType,
      background: params.background,
      content: params.content,
      frame: params.frame,
      opacity: params.opacity,
      blendMode: params.blendMode,
      effects: params.effects,
      transform: params.transform,
      sourceOrientation: params.sourceOrientation,
      transitionIn: params.transitionIn,
      transitionOut: params.transitionOut,
      transitionFilter: null,
      transitionFilterType: null,
      mask: params.mask,
      hudDirty: true,
      hudMediaStates: {},
    };

    const ctx = clip.canvas?.getContext('2d');
    if (ctx) {
      clip.ctx = ctx as OffscreenCanvasRenderingContext2D;
      const canvasSource = new CanvasSource({
        resource: clip.canvas as unknown as HTMLCanvasElement,
      });
      // Replace instead of mutating sprite.texture.source (which would mutate Texture.EMPTY).
      // `dynamic`: the HUD canvas is resized on redraw; a non-dynamic Sprite would
      // keep the stale quad size and squash the content.
      const texture = new Texture({ source: canvasSource, dynamic: true });
      sprite.texture = texture;
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
    // `dynamic`: the imageSource is resized at runtime (frame-size changes,
    // effect padding); the Sprite must re-read the texture size on update.
    const texture = new Texture({ source: params.imageSource, dynamic: true });
    const sprite = new Sprite(texture);
    sprite.width = 1;
    sprite.height = 1;
    sprite.visible = false;
    (sprite as { __clipId?: string }).__clipId = params.itemId;

    return {
      itemId: params.itemId,
      trackId: params.trackId,
      layer: params.layer,
      sourcePath: params.sourcePath,
      fileHandle: params.fileHandle,
      startTicks: params.startTicks,
      endTicks: params.endTicks,
      durationTicks: params.durationTicks,
      sourceStartTicks: params.sourceStartTicks,
      sourceRangeDurationTicks: params.sourceRangeDurationTicks,
      sourceDurationTicks: params.sourceDurationTicks,
      speed: params.speed,
      sprite,
      clipType: 'media',
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
      sourceOrientation: params.sourceOrientation,
      transitionIn: params.transitionIn,
      transitionOut: params.transitionOut,
      mask: params.mask,
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
      freezeFrameSourceTicks?: number;
      imageSource: ImageSource;
      sourceRotation?: number;
    },
  ): CompositorClip {
    // `dynamic`: the imageSource is resized at runtime (frame-size changes,
    // effect padding); the Sprite must re-read the texture size on update.
    const texture = new Texture({ source: params.imageSource, dynamic: true });
    const sprite = new Sprite(texture);
    sprite.width = 1;
    sprite.height = 1;
    sprite.visible = false;
    (sprite as { __clipId?: string }).__clipId = params.itemId;

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
      startTicks: params.startTicks,
      endTicks: params.endTicks,
      durationTicks: params.durationTicks,
      sourceStartTicks: params.sourceStartTicks,
      sourceRangeDurationTicks: params.sourceRangeDurationTicks,
      sourceDurationTicks: params.sourceDurationTicks,
      speed: params.speed,
      freezeFrameSourceTicks: params.freezeFrameSourceTicks,
      sprite,
      clipType: 'media',
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
      sourceOrientation: params.sourceOrientation,
      transitionIn: params.transitionIn,
      transitionOut: params.transitionOut,
      mask: params.mask,
      sourceRotation: params.sourceRotation,
    };
  }

  public attachClipSprite(params: {
    clip: CompositorClip;
    trackRuntime: CompositorTrack | null;
    stage: Container;
  }) {
    if (!params.clip.sprite) return;
    if (params.trackRuntime) {
      params.trackRuntime.container.addChild(params.clip.sprite);
      return;
    }

    params.stage.addChild(params.clip.sprite);
  }
}
