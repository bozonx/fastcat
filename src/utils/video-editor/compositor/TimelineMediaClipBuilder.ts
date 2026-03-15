import { ImageSource } from 'pixi.js';
import type { VideoClipEffect } from '~/timeline/types';
import type { ClipFactory } from './ClipFactory';
import type { LayoutApplier } from './LayoutApplier';
import { resolveBlendMode, type CompositorClip } from './types';

export interface TimelineImageClipDescriptor {
  itemId: string;
  trackId?: string;
  layer: number;
  sourcePath: string;
  fileHandle: FileSystemFileHandle;
  startUs: number;
  endUs: number;
  requestedTimelineDurationUs: number;
  speed?: number;
}

export interface TimelineVideoClipDescriptor {
  itemId: string;
  trackId?: string;
  layer: number;
  sourcePath: string;
  fileHandle: FileSystemFileHandle;
  startUs: number;
  endUs: number;
  durationUs: number;
  sourceStartUs: number;
  sourceRangeDurationUs: number;
  sourceDurationUs: number;
  speed?: number;
  freezeFrameSourceUs?: number;
}

export interface TimelineMediaClipBuilderContext {
  clipFactory: ClipFactory;
  layoutApplier: LayoutApplier;
}

export class TimelineMediaClipBuilder {
  constructor(private readonly context: TimelineMediaClipBuilderContext) {}

  public createImageClip(params: {
    clipData: any;
    descriptor: TimelineImageClipDescriptor;
    bitmap: ImageBitmap | null;
    imageSource: ImageSource;
    toVideoEffects: (value: unknown) => VideoClipEffect[] | undefined;
  }): CompositorClip {
    const { clipData, descriptor, bitmap, imageSource, toVideoEffects } = params;
    const clip = this.context.clipFactory.createImageClip({
      itemId: descriptor.itemId,
      trackId: descriptor.trackId,
      layer: descriptor.layer,
      sourcePath: descriptor.sourcePath,
      fileHandle: descriptor.fileHandle,
      startUs: descriptor.startUs,
      endUs: descriptor.endUs,
      durationUs: Math.max(0, descriptor.requestedTimelineDurationUs),
      sourceStartUs: 0,
      sourceRangeDurationUs: Math.max(0, descriptor.requestedTimelineDurationUs),
      sourceDurationUs: Math.max(0, descriptor.requestedTimelineDurationUs),
      speed: descriptor.speed,
      bitmap,
      imageSource,
      opacity: clipData.opacity,
      blendMode: resolveBlendMode(clipData.blendMode),
      effects: toVideoEffects(clipData.effects),
      transform: clipData.transform,
      transitionIn: clipData.transitionIn,
      transitionOut: clipData.transitionOut,
    });

    if (bitmap) {
      const frameW = Math.max(1, Math.round((bitmap as any).width ?? 1));
      const frameH = Math.max(1, Math.round((bitmap as any).height ?? 1));
      this.context.layoutApplier.applySpriteLayout(frameW, frameH, clip);
    }

    return clip;
  }

  public createVideoClip(params: {
    clipData: any;
    descriptor: TimelineVideoClipDescriptor;
    input: CompositorClip['input'];
    sink: CompositorClip['sink'];
    firstTimestampS?: number;
    frameRate?: number;
    imageSource: ImageSource;
    toVideoEffects: (value: unknown) => VideoClipEffect[] | undefined;
  }): CompositorClip {
    const {
      clipData,
      descriptor,
      input,
      sink,
      firstTimestampS,
      frameRate,
      imageSource,
      toVideoEffects,
    } = params;

    return this.context.clipFactory.createVideoClip({
      itemId: descriptor.itemId,
      trackId: descriptor.trackId,
      layer: descriptor.layer,
      sourcePath: descriptor.sourcePath,
      fileHandle: descriptor.fileHandle,
      input,
      sink,
      firstTimestampS,
      frameRate,
      startUs: descriptor.startUs,
      endUs: descriptor.endUs,
      durationUs: descriptor.durationUs,
      sourceStartUs: descriptor.sourceStartUs,
      sourceRangeDurationUs: descriptor.sourceRangeDurationUs,
      sourceDurationUs: descriptor.sourceDurationUs,
      speed: descriptor.speed,
      freezeFrameSourceUs: descriptor.freezeFrameSourceUs,
      imageSource,
      opacity: clipData.opacity,
      blendMode: resolveBlendMode(clipData.blendMode),
      effects: toVideoEffects(clipData.effects),
      transform: clipData.transform,
      transitionIn: clipData.transitionIn,
      transitionOut: clipData.transitionOut,
    });
  }
}
