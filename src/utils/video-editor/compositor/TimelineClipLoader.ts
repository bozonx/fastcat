import { parseHexColor, sanitizeTimelineColor } from '../utils';
import type { VideoClipEffect } from '~/timeline/types';
import {
  areShapeConfigsEqual,
  areTextClipStylesEqual,
  resolveBlendMode,
  type CompositorClip,
  type CompositorTrack,
} from './types';

export type TimelineClipType = 'background' | 'adjustment' | 'media' | 'text' | 'shape' | 'hud';

export interface TimelineClipLoaderInput {
  index: number;
  clipData: Record<string, unknown>;
  sequentialTimeUs: number;
  fallbackTrackId?: string | null;
}

export interface TimelineClipDescriptor {
  clipType: TimelineClipType;
  itemId: string;
  sourcePath: string;
  hudBackgroundPath?: string;
  hudContentPath?: string;
  hudFramePath?: string;
  maskPath?: string;
  sourceStartUs: number;
  freezeFrameSourceUs?: number;
  layer: number;
  trackId?: string;
  requestedTimelineDurationUs: number;
  requestedSourceRangeDurationUs: number;
  requestedSourceDurationUs: number;
  speed?: number;
  startUs: number;
  endUsFallback: number;
}

export interface UpdateReusableClipContext {
  clipData: Record<string, unknown>;
  descriptor: TimelineClipDescriptor;
  reusable: CompositorClip;
  toVideoEffects: (value: unknown) => VideoClipEffect[] | undefined;
  getTrackRuntimeForClip: (
    clip: Pick<CompositorClip, 'trackId' | 'layer'>,
  ) => CompositorTrack | null;
  applySolidLayout: (clip: CompositorClip) => void;
}

export interface UpdateReusableClipResult {
  clip: CompositorClip;
  sequentialTimeUs: number;
}

export class TimelineClipLoader {
  public describe(input: TimelineClipLoaderInput): TimelineClipDescriptor | null {
    const { clipData, index, sequentialTimeUs, fallbackTrackId } = input;
    if (clipData?.kind !== 'clip') {
      return null;
    }

    const clipTypeRaw = clipData.clipType;
    const clipType: TimelineClipType =
      clipTypeRaw === 'background' ||
      clipTypeRaw === 'adjustment' ||
      clipTypeRaw === 'media' ||
      clipTypeRaw === 'text' ||
      clipTypeRaw === 'shape' ||
      clipTypeRaw === 'hud'
        ? clipTypeRaw
        : 'media';

    const itemId =
      typeof clipData.id === 'string' && clipData.id.length > 0 ? clipData.id : `clip_${index}`;
    const sourceRaw = clipData.source as Record<string, unknown> | undefined;
    const sourcePath =
      typeof sourceRaw?.path === 'string' && sourceRaw.path.length > 0 ? sourceRaw.path : '';

    const hudBackgroundPath = String(
      (
        (clipData.background as Record<string, unknown> | undefined)?.source as
          | Record<string, unknown>
          | undefined
      )?.path ?? '',
    );
    const hudContentPath = String(
      (
        (clipData.content as Record<string, unknown> | undefined)?.source as
          | Record<string, unknown>
          | undefined
      )?.path ?? '',
    );
    const hudFramePath = String(
      (
        (clipData.frame as Record<string, unknown> | undefined)?.source as
          | Record<string, unknown>
          | undefined
      )?.path ?? '',
    );
    const maskPath = String(
      (
        (clipData.mask as Record<string, unknown> | undefined)?.source as
          | Record<string, unknown>
          | undefined
      )?.path ?? '',
    );

    const sourceStartUs = Math.max(
      0,
      Math.round(Number((clipData.sourceRange as Record<string, unknown>)?.startUs ?? 0)),
    );
    const freezeFrameSourceUsRaw = clipData.freezeFrameSourceUs;
    const freezeFrameSourceUs =
      typeof freezeFrameSourceUsRaw === 'number' && Number.isFinite(freezeFrameSourceUsRaw)
        ? Math.max(0, Math.round(freezeFrameSourceUsRaw))
        : undefined;
    const layer = Math.round(Number(clipData.layer ?? 0));
    const trackId =
      typeof clipData.trackId === 'string' && clipData.trackId.length > 0
        ? clipData.trackId
        : (fallbackTrackId ?? undefined);
    const requestedTimelineDurationUs = Math.max(
      0,
      Math.round(Number((clipData.timelineRange as Record<string, unknown>)?.durationUs ?? 0)),
    );
    const requestedSourceRangeDurationUs = Math.max(
      0,
      Math.round(
        Number(
          (clipData.sourceRange as Record<string, unknown>)?.durationUs ??
            requestedTimelineDurationUs,
        ),
      ),
    );
    const clipSourceDurationRaw = clipData.sourceDurationUs;
    const requestedSourceDurationUs = Math.max(
      0,
      Math.round(
        Number(
          typeof clipSourceDurationRaw === 'number' && clipSourceDurationRaw > 0
            ? clipSourceDurationRaw
            : 0,
        ),
      ),
    );

    const speedRaw = clipData.speed;
    const speed =
      typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw !== 0
        ? Math.max(-10, Math.min(10, speedRaw))
        : undefined;

    const startUs =
      typeof (clipData.timelineRange as Record<string, unknown>)?.startUs === 'number'
        ? Math.max(
            0,
            Math.round(Number((clipData.timelineRange as Record<string, unknown>).startUs)),
          )
        : sequentialTimeUs;

    return {
      clipType,
      itemId,
      sourcePath,
      hudBackgroundPath,
      hudContentPath,
      hudFramePath,
      maskPath,
      sourceStartUs,
      freezeFrameSourceUs,
      layer,
      trackId,
      requestedTimelineDurationUs,
      requestedSourceRangeDurationUs,
      requestedSourceDurationUs,
      speed,
      startUs,
      endUsFallback: startUs + Math.max(0, requestedTimelineDurationUs),
    };
  }

  public isReusableClipMatch(params: {
    reusable: CompositorClip | undefined;
    descriptor: TimelineClipDescriptor;
  }): params is { reusable: CompositorClip; descriptor: TimelineClipDescriptor } {
    const { reusable, descriptor } = params;
    if (!reusable) return false;

    if (descriptor.clipType === 'hud') {
      const prevBg = reusable.background?.source?.path ?? '';
      const prevContent = reusable.content?.source?.path ?? '';
      const prevFrame = reusable.frame?.source?.path ?? '';
      const prevMaskPath = reusable.mask?.source?.path ?? '';
      return (
        (reusable as { clipType: string }).clipType === descriptor.clipType &&
        prevBg === descriptor.hudBackgroundPath &&
        prevContent === descriptor.hudContentPath &&
        prevFrame === (descriptor.hudFramePath ?? '') &&
        prevMaskPath === (descriptor.maskPath ?? '')
      );
    }

    const prevMaskPath = reusable.mask?.source?.path ?? '';

    return Boolean(
      reusable.sourcePath === descriptor.sourcePath &&
      prevMaskPath === descriptor.maskPath &&
      (reusable as { clipType: string }).clipType === descriptor.clipType,
    );
  }

  public async updateReusableClip(
    context: UpdateReusableClipContext,
  ): Promise<UpdateReusableClipResult> {
    const {
      clipData,
      descriptor,
      reusable,
      toVideoEffects,
      getTrackRuntimeForClip,
      applySolidLayout,
    } = context;

    const safeSourceDurationUs =
      descriptor.requestedSourceDurationUs > 0
        ? descriptor.requestedSourceDurationUs
        : reusable.sourceDurationUs;
    const safeTimelineDurationUs =
      descriptor.requestedTimelineDurationUs > 0
        ? descriptor.requestedTimelineDurationUs
        : safeSourceDurationUs;

    if (reusable.clipKind === 'video') {
      const hasFirstTimestamp =
        typeof reusable.firstTimestampS === 'number' && Number.isFinite(reusable.firstTimestampS);
      if (!hasFirstTimestamp && reusable.input) {
        try {
          const track = await reusable.input.getPrimaryVideoTrack();
          if (track) {
            reusable.firstTimestampS = await track.getFirstTimestamp();
          }
        } catch {
          // ignore
        }
      }
    }

    reusable.startUs = descriptor.startUs;
    reusable.durationUs = safeTimelineDurationUs;
    reusable.endUs = descriptor.startUs + safeTimelineDurationUs;
    reusable.sourceStartUs = descriptor.sourceStartUs;
    reusable.sourceRangeDurationUs =
      descriptor.requestedSourceRangeDurationUs > 0
        ? descriptor.requestedSourceRangeDurationUs
        : reusable.sourceRangeDurationUs;
    reusable.sourceDurationUs = safeSourceDurationUs;
    reusable.speed = descriptor.speed;
    reusable.freezeFrameSourceUs = descriptor.freezeFrameSourceUs;
    reusable.layer = descriptor.layer;
    reusable.trackId = descriptor.trackId;
    reusable.opacity = clipData.opacity as number | undefined;
    reusable.blendMode = resolveBlendMode(clipData.blendMode as string | undefined);
    reusable.effects = toVideoEffects(clipData.effects);
    reusable.transform = clipData.transform as import('~/timeline/types').ClipTransform | undefined;
    reusable.transitionIn = clipData.transitionIn as
      | import('~/timeline/types').ClipTransition
      | undefined;
    reusable.transitionOut = clipData.transitionOut as
      | import('~/timeline/types').ClipTransition
      | undefined;
    reusable.mask = clipData.mask as import('~/timeline/types').ClipMask | undefined;

    if (reusable.clipKind === 'text') {
      const nextText = String(clipData.text ?? '');
      const nextStyle = clipData.style as import('~/timeline/types').TextClipStyle | undefined;
      reusable.textDirty =
        reusable.text !== nextText || !areTextClipStylesEqual(reusable.style, nextStyle);
      reusable.text = nextText;
      reusable.style = nextStyle;
    }

    const reusableTrack = getTrackRuntimeForClip(reusable);
    if (reusableTrack && reusable.sprite && reusable.sprite.parent !== reusableTrack.container) {
      reusableTrack.container.addChild(reusable.sprite);
    }

    if (reusable.clipKind === 'solid') {
      reusable.backgroundColor = sanitizeTimelineColor(clipData.backgroundColor, '#000000');
      if (reusable.sprite) {
        reusable.sprite.tint = parseHexColor(reusable.backgroundColor);
      }
      applySolidLayout(reusable);
    }

    if (reusable.clipKind === 'shape') {
      reusable.shapeType = (clipData.shapeType ??
        reusable.shapeType ??
        'square') as import('~/timeline/types').ShapeType;
      reusable.fillColor = String(clipData.fillColor ?? reusable.fillColor ?? '#ffffff');
      reusable.strokeColor = String(clipData.strokeColor ?? reusable.strokeColor ?? '#000000');
      reusable.strokeWidth = Number(clipData.strokeWidth ?? reusable.strokeWidth ?? 0);
      const nextConfig = clipData.shapeConfig;
      if (
        !areShapeConfigsEqual(
          reusable.shapeConfig as Record<string, unknown>,
          nextConfig as Record<string, unknown>,
        )
      ) {
        reusable.shapeConfig = nextConfig ? JSON.parse(JSON.stringify(nextConfig)) : undefined;
      }
      reusable.shapeDirty = true;
    }

    if (reusable.clipKind === 'hud') {
      reusable.hudType = (clipData.hudType ?? reusable.hudType ?? 'media_frame') as 'media_frame';
      reusable.background = clipData.background
        ? JSON.parse(JSON.stringify(clipData.background))
        : undefined;
      reusable.content = clipData.content
        ? JSON.parse(JSON.stringify(clipData.content))
        : undefined;
      reusable.frame = clipData.frame ? JSON.parse(JSON.stringify(clipData.frame)) : undefined;
      reusable.hudDirty = true;
    }

    if (reusable.sprite) reusable.sprite.visible = false;

    return {
      clip: reusable,
      sequentialTimeUs: Math.max(descriptor.endUsFallback, reusable.endUs),
    };
  }
}
