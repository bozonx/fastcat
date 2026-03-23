import { parseHexColor, sanitizeTimelineColor } from '../utils';
import type { VideoClipEffect } from '~/timeline/types';
import type { ClipFactory } from './ClipFactory';
import type { HudMediaLoader, HudMediaLoaderDeps } from './HudMediaLoader';
import type { MediaClipLoader, MediaClipLoaderMediabunny } from './MediaClipLoader';
import { resolveBlendMode, type CompositorClip, type HudMediaState } from './types';
import { Sprite, Texture } from 'pixi.js';

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
  mediaClipLoader: MediaClipLoader;
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
      mask: clipData.mask,
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
          frame: clipData.frame,
        });
    }
  }

  public async initializeHudMediaStates(params: {
    clip: CompositorClip;
    deps: HudMediaLoaderDeps;
    mediabunny: MediaClipLoaderMediabunny;
  }) {
    const { clip, deps, mediabunny } = params;

    const resetState = (s: import('./types').HudMediaState | undefined) => {
      if (!s) return;
      import('../utils').then(({ safeDispose }) => {
        safeDispose(s.sink);
        safeDispose(s.input);
        if (s.lastVideoFrame) {
          safeDispose(s.lastVideoFrame);
          s.lastVideoFrame = null;
        }
        if (s.bitmap) {
          try { s.bitmap.close(); } catch {}
          s.bitmap = null;
        }
      });
    };

    const loadState = async (path: string): Promise<HudMediaState | null> => {
      const fileHandle = await deps.getFileHandleByPath(path);
      if (!fileHandle) return null;
      const file = (await deps.getFileByPath?.(path)) ?? (await fileHandle.getFile());
      
      const isImage = (typeof file?.type === 'string' && file.type.startsWith('image/')) ||
                      path.match(/\.(jpe?g|png|webp|gif|svg)$/i);
      
      if (isImage) {
        return await this.context.hudMediaLoader.loadImageState({
          sourcePath: path,
          deps,
        });
      }

      try {
        const loadedVideo = await this.context.mediaClipLoader.loadVideoRuntime({
          mediabunny,
          file,
          sourceStartUs: 0,
          requestedTimelineDurationUs: clip.durationUs,
          requestedSourceDurationUs: 0,
          requestedSourceRangeDurationUs: 0,
          startUs: clip.startUs,
        });
        
        if (loadedVideo) {
          return {
            sourcePath: path,
            fileHandle: fileHandle,
            input: loadedVideo.input,
            sink: loadedVideo.sink,
            firstTimestampS: loadedVideo.firstTimestampS,
            sourceDurationUs: loadedVideo.sourceDurationUs,
            clipKind: 'video',
            sourceKind: 'videoFrame',
            imageSource: loadedVideo.imageSource,
            sprite: new Sprite(Texture.EMPTY),
            lastVideoFrame: null,
            bitmap: null,
          };
        }
      } catch (err: any) {
        if (err?.message !== 'Input has an unsupported or unrecognizable format.') {
          console.error('[VideoCompositor] Failed to load HUD video state', err);
        }
      }
      return null;
    };

    const bgPath = clip.background?.source?.path;
    if (!bgPath) {
      resetState(clip.hudMediaStates?.background);
      if (clip.hudMediaStates) clip.hudMediaStates.background = undefined;
    } else if (clip.hudMediaStates?.background?.sourcePath !== bgPath) {
      resetState(clip.hudMediaStates?.background);
      try {
        const state = await loadState(bgPath);
        if (state && clip.hudMediaStates) clip.hudMediaStates.background = state;
      } catch (e) {
        console.error('[VideoCompositor] Failed to load HUD background', e);
      }
    }

    const contentPath = clip.content?.source?.path;
    if (!contentPath) {
      resetState(clip.hudMediaStates?.content);
      if (clip.hudMediaStates) clip.hudMediaStates.content = undefined;
    } else if (clip.hudMediaStates?.content?.sourcePath !== contentPath) {
      resetState(clip.hudMediaStates?.content);
      try {
        const state = await loadState(contentPath);
        if (state && clip.hudMediaStates) clip.hudMediaStates.content = state;
      } catch (e) {
        console.error('[VideoCompositor] Failed to load HUD content', e);
      }
    }

    const framePath = clip.frame?.source?.path;
    if (!framePath) {
      resetState(clip.hudMediaStates?.frame);
      if (clip.hudMediaStates) clip.hudMediaStates.frame = undefined;
    } else if (clip.hudMediaStates?.frame?.sourcePath !== framePath) {
      resetState(clip.hudMediaStates?.frame);
      try {
        const state = await loadState(framePath);
        if (state && clip.hudMediaStates) clip.hudMediaStates.frame = state;
      } catch (e) {
        console.error('[VideoCompositor] Failed to load HUD frame', e);
      }
    }
  }

  public async initializeMaskState(params: {
    clip: CompositorClip;
    deps: HudMediaLoaderDeps;
    mediabunny: MediaClipLoaderMediabunny;
  }) {
    const { clip, deps, mediabunny } = params;
    const maskPath = clip.mask?.source?.path;
    if (!maskPath) return;

    try {
      const fileHandle = await deps.getFileHandleByPath(maskPath);
      if (!fileHandle) return;
      const file = (await deps.getFileByPath?.(maskPath)) ?? (await fileHandle.getFile());
      
      const isImage = (typeof file?.type === 'string' && file.type.startsWith('image/')) ||
                      maskPath.match(/\.(jpe?g|png|webp|gif|svg)$/i);
      
      if (isImage) {
        clip.maskState = await this.context.hudMediaLoader.loadImageState({
          sourcePath: maskPath,
          deps,
        });
      } else {
        const loadedVideo = await this.context.mediaClipLoader.loadVideoRuntime({
          mediabunny,
          file,
          sourceStartUs: 0,
          requestedTimelineDurationUs: clip.durationUs,
          requestedSourceDurationUs: 0,
          requestedSourceRangeDurationUs: 0,
          startUs: clip.startUs,
        });
        
        if (loadedVideo) {
          clip.maskState = {
            sourcePath: maskPath,
            fileHandle,
            input: loadedVideo.input,
            sink: loadedVideo.sink,
            firstTimestampS: loadedVideo.firstTimestampS,
            sourceDurationUs: loadedVideo.sourceDurationUs,
            clipKind: 'video',
            sourceKind: 'videoFrame',
            imageSource: loadedVideo.imageSource,
            sprite: new Sprite(Texture.EMPTY),
            lastVideoFrame: null,
            bitmap: null,
          };
        }
      }
    } catch (e) {
      console.error('[VideoCompositor] Failed to load clip mask', e);
    }
  }
}
