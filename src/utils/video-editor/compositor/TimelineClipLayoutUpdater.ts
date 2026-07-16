import { parseHexColor, sanitizeTimelineColor } from '../utils';
import { cloneValue } from '~/utils/clone';
import { bakeClipEffectAnimations } from '~/effects/animation-bake';
import {
  areShapeConfigsEqual,
  areTextClipStylesEqual,
  resolveBlendMode,
  type CompositorClip,
} from './types';
import type { TextClipStyle, ShapeType } from '~/timeline/types';
import type { WorkerVideoPayloadItem } from '../../../composables/timeline/export/types';

export interface TimelineClipLayoutUpdaterParams {
  clip: CompositorClip;
  next: WorkerVideoPayloadItem;
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

    const n = next as unknown as Record<string, unknown>;
    const timelineRange = n['timelineRange'] as
      | { startTicks?: unknown; durationTicks?: unknown }
      | undefined;
    const sourceRange = n['sourceRange'] as
      | { startTicks?: unknown; durationTicks?: unknown }
      | undefined;
    const startTicks = Math.max(
      0,
      Math.round(Number(timelineRange?.startTicks ?? clip.startTicks)),
    );
    const timelineDurationTicks = Math.max(
      0,
      Math.round(Number(timelineRange?.durationTicks ?? clip.durationTicks)),
    );
    const sourceStartTicks = Math.max(
      0,
      Math.round(Number(sourceRange?.startTicks ?? clip.sourceStartTicks)),
    );
    const sourceRangeDurationTicks = Math.max(
      0,
      Math.round(Number(sourceRange?.durationTicks ?? clip.sourceRangeDurationTicks)),
    );
    const nextSourceDurationRaw = n['sourceDurationTicks'];
    const sourceDurationTicks = Math.max(
      0,
      Math.round(
        Number(
          typeof nextSourceDurationRaw === 'number' && nextSourceDurationRaw > 0
            ? nextSourceDurationRaw
            : clip.sourceDurationTicks,
        ),
      ),
    );
    const layer = Math.round(Number(n['layer'] ?? clip.layer ?? 0));
    const speedRaw = n['speed'];
    const speed =
      typeof speedRaw === 'number' && Number.isFinite(speedRaw) && speedRaw !== 0
        ? Math.max(-10, Math.min(10, speedRaw))
        : undefined;

    const freezeFrameSourceTicksRaw = n['freezeFrameSourceTicks'];
    const freezeFrameSourceTicks =
      typeof freezeFrameSourceTicksRaw === 'number' && Number.isFinite(freezeFrameSourceTicksRaw)
        ? Math.max(0, Math.round(freezeFrameSourceTicksRaw))
        : undefined;

    clip.startTicks = startTicks;
    clip.durationTicks = timelineDurationTicks;
    clip.endTicks = startTicks + timelineDurationTicks;
    clip.sourceStartTicks = sourceStartTicks;
    clip.sourceRangeDurationTicks = sourceRangeDurationTicks;
    clip.sourceDurationTicks = sourceDurationTicks;
    clip.speed = speed;
    clip.freezeFrameSourceTicks = freezeFrameSourceTicks;
    clip.layer = layer;
    clip.trackId =
      typeof n['trackId'] === 'string' && (n['trackId'] as string).length > 0
        ? (n['trackId'] as string)
        : (fallbackTrackId ?? undefined);
    clip.opacity = n['opacity'] as number | undefined;
    clip.opacityActive = n['opacityActive'] as boolean | undefined;
    clip.blendMode = resolveBlendMode(n['blendMode']);
    clip.blendModeActive = n['blendModeActive'] as boolean | undefined;
    clip.effects = toVideoEffects(n['effects']);
    clip.transform = n['transform'] as CompositorClip['transform'];
    clip.transformActive = n['transformActive'] as boolean | undefined;
    clip.animations = n['animations'] as CompositorClip['animations'];
    clip.bakedEffects = bakeClipEffectAnimations(clip.effects, clip.animations);
    clip.sourceOrientation = n['sourceOrientation'] as CompositorClip['sourceOrientation'];
    clip.mask = n['mask'] as CompositorClip['mask'];
    clip.maskActive = n['maskActive'] as boolean | undefined;

    const prevTransitionInType = clip.transitionIn?.type ?? null;
    const nextTransitionIn = n['transitionIn'] as { type?: string } | undefined;
    const nextTransitionInType = nextTransitionIn?.type ?? null;
    clip.transitionIn = n['transitionIn'] as CompositorClip['transitionIn'];
    clip.transitionOut = n['transitionOut'] as CompositorClip['transitionOut'];
    if (prevTransitionInType !== nextTransitionInType) {
      clearClipTransitionFilter(clip);
    }

    const nextSnapToPixelGrid =
      typeof n['snapToPixelGrid'] === 'boolean' ? (n['snapToPixelGrid'] as boolean) : undefined;
    const snapChanged = clip.snapToPixelGrid !== nextSnapToPixelGrid;
    clip.snapToPixelGrid = nextSnapToPixelGrid;

    if (clip.clipKind === 'text') {
      const nextText = String(n['text'] ?? '');
      const nextStyle = n['style'] as TextClipStyle | undefined;
      const styleChanged = !areTextClipStylesEqual(clip.style, nextStyle);

      clip.textDirty =
        clip.text !== nextText || styleChanged || snapChanged || clip.textDirty === true;
      clip.text = nextText;
      clip.style = nextStyle ? cloneValue(nextStyle) : undefined;
    }

    if (clip.clipKind === 'shape') {
      const nextType = (n['shapeType'] as string) ?? 'square';
      const nextFill = String(n['fillColor'] ?? '#ffffff');
      const nextStroke = String(n['strokeColor'] ?? '#000000');
      const nextStrokeWidth = Number(n['strokeWidth'] ?? 0);
      const nextConfig = n['shapeConfig'];

      if (
        clip.shapeType !== nextType ||
        clip.fillColor !== nextFill ||
        clip.strokeColor !== nextStroke ||
        clip.strokeWidth !== nextStrokeWidth ||
        snapChanged ||
        !areShapeConfigsEqual(
          clip.shapeConfig as unknown as Record<string, unknown>,
          nextConfig as unknown as Record<string, unknown>,
        ) ||
        clip.shapeDirty === true
      ) {
        clip.shapeDirty = true;
      }

      clip.shapeType = nextType as ShapeType;
      clip.fillColor = nextFill;
      clip.strokeColor = nextStroke;
      clip.strokeWidth = nextStrokeWidth;
      clip.shapeConfig = nextConfig ? cloneValue(nextConfig) : undefined;
    }

    if (clip.clipKind === 'hud') {
      const nextBg = n['background'];
      const nextContent = n['content'];
      const nextFrame = n['frame'];
      const nextHudType = (n['hudType'] as string) ?? 'media_frame';

      const hudChanged =
        clip.hudType !== nextHudType ||
        JSON.stringify(clip.background) !== JSON.stringify(nextBg) ||
        JSON.stringify(clip.content) !== JSON.stringify(nextContent) ||
        JSON.stringify(clip.frame) !== JSON.stringify(nextFrame);

      if (hudChanged || clip.hudDirty === true) {
        clip.hudType = nextHudType as typeof clip.hudType;
        clip.background = nextBg ? cloneValue(nextBg) : undefined;
        clip.content = nextContent ? cloneValue(nextContent) : undefined;
        clip.frame = nextFrame ? cloneValue(nextFrame) : undefined;
        clip.hudDirty = true;
      }
    }

    if (clip.clipKind === 'solid') {
      clip.backgroundColor = sanitizeTimelineColor(
        n['backgroundColor'],
        clip.backgroundColor ?? '#000000',
      );
      if (clip.sprite) {
        clip.sprite.tint = parseHexColor(clip.backgroundColor);
      }
    }

    applyClipLayoutForCurrentSource(clip);

    if (!clip.effectFilters) {
      clip.effectFilters = new Map();
    }
  }
}
