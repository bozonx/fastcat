import { ref, type Ref } from 'vue';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import { getVideoEffectManifest, getAudioEffectManifest } from '~/effects';
import {
  getTransitionManifest,
  DEFAULT_TRANSITION_MODE,
  DEFAULT_TRANSITION_CURVE,
  normalizeTransitionParams,
} from '~/transitions';
import { useDndDropZone } from '~/composables/dnd/useDndDropZone';
import type { DndDragContext, DndPayload } from '~/composables/dnd/dndTypes';

interface UseClipDropOptions {
  track: Ref<TimelineTrack>;
  clipItem: Ref<TimelineClipItem | null>;
  canEditClipContent: Ref<boolean>;
  updateClipProperties: (trackId: string, itemId: string, patch: Record<string, unknown>) => void;
  updateClipTransition: (
    trackId: string,
    itemId: string,
    patch: {
      transitionIn?: import('~/timeline/types').ClipTransition | null;
      transitionOut?: import('~/timeline/types').ClipTransition | null;
    },
  ) => void;
  selectTimelineItem: (trackId: string, itemId: string, kind: 'clip') => void;
  selectTimelineTransition: (trackId: string, itemId: string, edge: 'in' | 'out') => void;
  triggerScrollToEffects: () => void;
  defaultTransitionDurationUs: Ref<number>;
}

export function useClipDrop(options: UseClipDropOptions) {
  const isDraggingOver = ref(false);

  function canAccept(payload: DndPayload): boolean {
    return (
      options.canEditClipContent.value &&
      Boolean(options.clipItem.value) &&
      (payload.source === 'effect' || payload.source === 'transition')
    );
  }

  function onOver(ctx: DndDragContext) {
    isDraggingOver.value = true;
    ctx.setOperation(ctx.payload.source === 'transition' ? 'transition' : 'effect');
  }

  function onLeave() {
    isDraggingOver.value = false;
  }

  function onDrop(ctx: DndDragContext) {
    isDraggingOver.value = false;
    const clip = options.clipItem.value;
    if (!options.canEditClipContent.value || !clip) return;

    const type = (ctx.payload.data as { type?: string })?.type;
    if (!type) return;

    if (ctx.payload.source === 'effect') {
      _handleEffectDrop(clip, type);
    } else if (ctx.payload.source === 'transition') {
      _handleTransitionDrop(ctx, clip, type);
    }
  }

  const { zoneAttrs: dropZoneAttrs } = useDndDropZone(
    { canAccept, onEnter: onOver, onOver, onLeave, onDrop },
    'clip',
  );

  function _handleEffectDrop(clip: TimelineClipItem, effectType: string) {
    const audioManifest = getAudioEffectManifest(effectType);
    const videoManifest = getVideoEffectManifest(effectType);

    let manifest: typeof audioManifest | typeof videoManifest | undefined;
    let target: 'audio' | 'video' | undefined;

    if (audioManifest && videoManifest) {
      if (options.track.value.kind === 'audio') {
        manifest = audioManifest;
        target = 'audio';
      } else {
        manifest = videoManifest;
        target = 'video';
      }
    } else if (audioManifest) {
      manifest = audioManifest;
      target = 'audio';
    } else if (videoManifest) {
      manifest = videoManifest;
      target = 'video';
    }

    if (!manifest) return;

    const newEffect = {
      id: `effect_${Date.now()}`,
      type: effectType,
      enabled: true,
      target,
      ...manifest.defaultValues,
    };

    options.updateClipProperties(options.track.value.id, clip.id, {
      effects: [newEffect, ...((clip as { effects?: unknown[] }).effects ?? [])],
    });
    options.selectTimelineItem(options.track.value.id, clip.id, 'clip');

    setTimeout(() => options.triggerScrollToEffects(), 50);
  }

  function _handleTransitionDrop(
    ctx: DndDragContext,
    clip: TimelineClipItem,
    transitionType: string,
  ) {
    const manifest = getTransitionManifest(transitionType);
    if (!manifest) return;

    // Resolve the clip box from the element under the pointer; the edge (in/out)
    // is decided by which half of the clip the pointer is over.
    const clipEl =
      (ctx.targetEl as HTMLElement | null)?.closest('[data-clip-id]') ??
      (ctx.targetEl as HTMLElement | null);
    const rect = clipEl?.getBoundingClientRect();
    const edge: 'in' | 'out' =
      rect && ctx.pointer.clientX - rect.left <= rect.width / 2 ? 'in' : 'out';

    const defaultUs = Math.max(
      0,
      Math.round(Number(options.defaultTransitionDurationUs.value ?? 1_000_000)),
    );
    const durationUs = Math.min(defaultUs, Math.round(clip.timelineRange.durationUs * 0.3));

    const transition = {
      type: transitionType,
      durationUs,
      mode: DEFAULT_TRANSITION_MODE,
      curve: DEFAULT_TRANSITION_CURVE,
      params: normalizeTransitionParams(transitionType) as Record<string, unknown> | undefined,
    } satisfies import('~/timeline/types').ClipTransition;

    options.updateClipTransition(
      options.track.value.id,
      clip.id,
      edge === 'in' ? { transitionIn: transition } : { transitionOut: transition },
    );
    options.selectTimelineTransition(options.track.value.id, clip.id, edge);
  }

  return {
    isDraggingOver,
    dropZoneAttrs,
  };
}
