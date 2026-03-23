import { parseHexColor, sanitizeTimelineColor } from '../utils';
import {
  areShapeConfigsEqual,
  areTextClipStylesEqual,
  resolveBlendMode,
  type CompositorClip,
} from './types';

export interface TimelineClipLayoutUpdaterParams {
  clip: CompositorClip;
  next: any;
  fallbackTrackId?: string | null;
  toVideoEffects: (value: unknown) => CompositorClip['effects'];
  applyClipLayoutForCurrentSource: (clip: CompositorClip) => void;
  clearClipTransitionFilter: (clip: CompositorClip) => void;
}

export class TimelineClipLayoutUpdater {
  public update(params: TimelineClipLayoutUpdaterParams): void {
    const {
      clip,
      next,
      fallbackTrackId,
      toVideoEffects,
      applyClipLayoutForCurrentSource,
      clearClipTransitionFilter,
    } = params;

    const startUs = Math.max(0, Math.round(Number(next.timelineRange?.startUs ?? clip.startUs)));
    const timelineDurationUs = Math.max(
      0,
      Math.round(Number(next.timelineRange?.durationUs ?? clip.durationUs)),
    );
    const sourceStartUs = Math.max(
      0,
      Math.round(Number(next.sourceRange?.startUs ?? clip.sourceStartUs)),
    );
    const sourceRangeDurationUs = Math.max(
      0,
      Math.round(Number(next.sourceRange?.durationUs ?? clip.sourceRangeDurationUs)),
    );
    const nextSourceDurationRaw = (next as any).sourceDurationUs;
    const sourceDurationUs = Math.max(
      0,
      Math.round(
        Number(
          typeof nextSourceDurationRaw === 'number' && nextSourceDurationRaw > 0
            ? nextSourceDurationRaw
            : clip.sourceDurationUs,
        ),
      ),
    );
    const layer = Math.round(Number(next.layer ?? clip.layer ?? 0));
    const speedRaw = (next as any).speed;
    const speed =
      typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw !== 0
        ? Math.max(-10, Math.min(10, speedRaw))
        : undefined;

    const freezeFrameSourceUsRaw = (next as any).freezeFrameSourceUs;
    const freezeFrameSourceUs =
      typeof freezeFrameSourceUsRaw === 'number' && Number.isFinite(freezeFrameSourceUsRaw)
        ? Math.max(0, Math.round(freezeFrameSourceUsRaw))
        : undefined;

    clip.startUs = startUs;
    clip.durationUs = timelineDurationUs;
    clip.endUs = startUs + timelineDurationUs;
    clip.sourceStartUs = sourceStartUs;
    clip.sourceRangeDurationUs = sourceRangeDurationUs;
    clip.sourceDurationUs = sourceDurationUs;
    clip.speed = speed;
    clip.freezeFrameSourceUs = freezeFrameSourceUs;
    clip.layer = layer;
    clip.trackId =
      typeof next.trackId === 'string' && next.trackId.length > 0
        ? next.trackId
        : (fallbackTrackId ?? undefined);
    clip.opacity = next.opacity;
    clip.blendMode = resolveBlendMode((next as any).blendMode);
    clip.effects = toVideoEffects(next.effects);
    clip.transform = (next as any).transform;
    clip.mask = next.mask;
    applyClipLayoutForCurrentSource(clip);

    const prevTransitionInType = clip.transitionIn?.type ?? null;
    const nextTransitionInType = (next as any).transitionIn?.type ?? null;
    clip.transitionIn = (next as any).transitionIn;
    clip.transitionOut = (next as any).transitionOut;
    if (prevTransitionInType !== nextTransitionInType) {
      clearClipTransitionFilter(clip);
    }

    if (clip.clipKind === 'text') {
      const nextText = String((next as any).text ?? '');
      const nextStyle = (next as any).style;
      const styleChanged = !areTextClipStylesEqual(clip.style, nextStyle);

      clip.textDirty = clip.text !== nextText || styleChanged || clip.textDirty === true;
      clip.text = nextText;
      clip.style = nextStyle;
    }

    if (clip.clipKind === 'shape') {
      const nextType = (next as any).shapeType ?? 'square';
      const nextFill = String((next as any).fillColor ?? '#ffffff');
      const nextStroke = String((next as any).strokeColor ?? '#000000');
      const nextStrokeWidth = Number((next as any).strokeWidth ?? 0);
      const nextConfig = (next as any).shapeConfig;

      if (
        clip.shapeType !== nextType ||
        clip.fillColor !== nextFill ||
        clip.strokeColor !== nextStroke ||
        clip.strokeWidth !== nextStrokeWidth ||
        !areShapeConfigsEqual(clip.shapeConfig as any, nextConfig as any) ||
        clip.shapeDirty === true
      ) {
        clip.shapeDirty = true;
      }

      clip.shapeType = nextType;
      clip.fillColor = nextFill;
      clip.strokeColor = nextStroke;
      clip.strokeWidth = nextStrokeWidth;
      clip.shapeConfig = nextConfig ? JSON.parse(JSON.stringify(nextConfig)) : undefined;
    }

    if (clip.clipKind === 'hud') {
      const nextBg = (next as any).background;
      const nextContent = (next as any).content;
      const nextHudType = (next as any).hudType ?? 'media_frame';

      const hudChanged =
        clip.hudType !== nextHudType ||
        JSON.stringify(clip.background) !== JSON.stringify(nextBg) ||
        JSON.stringify(clip.content) !== JSON.stringify(nextContent);

      if (hudChanged || clip.hudDirty === true) {
        clip.hudType = nextHudType;
        clip.background = nextBg ? JSON.parse(JSON.stringify(nextBg)) : undefined;
        clip.content = nextContent ? JSON.parse(JSON.stringify(nextContent)) : undefined;
        clip.hudDirty = true;
      }
    }

    if (clip.clipKind === 'solid') {
      clip.backgroundColor = sanitizeTimelineColor(
        (next as any).backgroundColor,
        clip.backgroundColor ?? '#000000',
      );
      clip.sprite.tint = parseHexColor(clip.backgroundColor);
    }

    if (!clip.effectFilters) {
      clip.effectFilters = new Map();
    }
  }
}
