import { parseHexColor, sanitizeTimelineColor } from '../utils';
import type { VideoClipEffect } from '~/timeline/types';
import type { ClipFactory } from './ClipFactory';
import type { HudMediaLoader, HudMediaLoaderDeps } from './HudMediaLoader';
import { resolveBlendMode, type CompositorClip } from './types';

export interface TimelineFixedClipDescriptor {
  clipType: 'background' | 'adjustment' | 'text' | 'shape' | 'hud';
  itemId: string;
  trackId?: string;
  layer: number;
  startUs: number;
  endUs: number;
  requestedTimelineDurationUs: number;
  speed?: number;
}

export interface BuildFixedClipParams {
  clipData: any;
  descriptor: TimelineFixedClipDescriptor;
  toVideoEffects: (value: unknown) => VideoClipEffect[] | undefined;
}

export interface TimelineFixedClipBuilderContext {
  clipFactory: ClipFactory;
  hudMediaLoader: HudMediaLoader;
}

export class TimelineFixedClipBuilder {
  constructor(private readonly context: TimelineFixedClipBuilderContext) {}

  public build(params: BuildFixedClipParams): CompositorClip {
    const { clipData, descriptor, toVideoEffects } = params;
    const baseParams = {
      itemId: descriptor.itemId,
      trackId: descriptor.trackId,
      layer: descriptor.layer,
      startUs: descriptor.startUs,
      endUs: descriptor.endUs,
      durationUs: Math.max(0, descriptor.requestedTimelineDurationUs),
      sourceStartUs: 0,
      sourceRangeDurationUs: Math.max(0, descriptor.requestedTimelineDurationUs),
      sourceDurationUs: Math.max(0, descriptor.requestedTimelineDurationUs),
      speed: descriptor.speed,
      opacity: clipData.opacity,
      blendMode: resolveBlendMode(clipData.blendMode),
      effects: toVideoEffects(clipData.effects),
      transform: clipData.transform,
      transitionIn: clipData.transitionIn,
      transitionOut: clipData.transitionOut,
    };

    switch (descriptor.clipType) {
      case 'background': {
        const backgroundColor = sanitizeTimelineColor(clipData.backgroundColor, '#000000');
        const clip = this.context.clipFactory.createSolidClip({
          ...baseParams,
          backgroundColor,
          clipType: 'background',
        });
        clip.sprite.tint = parseHexColor(backgroundColor);
        return clip;
      }
      case 'text':
        return this.context.clipFactory.createTextClip({
          ...baseParams,
          text: String(clipData.text ?? ''),
          style: clipData.style,
        });
      case 'shape':
        return this.context.clipFactory.createShapeClip({
          ...baseParams,
          shapeType: clipData.shapeType ?? 'square',
          fillColor: String(clipData.fillColor ?? '#ffffff'),
          strokeColor: String(clipData.strokeColor ?? '#000000'),
          strokeWidth: Number(clipData.strokeWidth ?? 0),
        });
      case 'adjustment':
        return this.context.clipFactory.createAdjustmentClip(baseParams);
      case 'hud':
        return this.context.clipFactory.createHudClip({
          ...baseParams,
          hudType: clipData.hudType ?? 'media_frame',
          background: clipData.background,
          content: clipData.content,
        });
    }
  }

  public async initializeHudMediaStates(params: {
    clip: CompositorClip;
    deps: HudMediaLoaderDeps;
  }) {
    const { clip, deps } = params;
    const bgPath = clip.background?.source?.path;
    if (bgPath) {
      try {
        const state = await this.context.hudMediaLoader.loadImageState({ sourcePath: bgPath, deps });
        if (state && clip.hudMediaStates) {
          clip.hudMediaStates.background = state;
        }
      } catch (e) {
        console.error('[VideoCompositor] Failed to load HUD background', e);
      }
    }

    const contentPath = clip.content?.source?.path;
    if (contentPath) {
      try {
        const state = await this.context.hudMediaLoader.loadImageState({
          sourcePath: contentPath,
          deps,
        });
        if (state && clip.hudMediaStates) {
          clip.hudMediaStates.content = state;
        }
      } catch (e) {
        console.error('[VideoCompositor] Failed to load HUD content', e);
      }
    }
  }
}
