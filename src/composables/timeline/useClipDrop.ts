import { ref, type Ref } from 'vue';
import type { TimelineClipItem, TimelineTrack } from '~/timeline/types';
import { getVideoEffectManifest, getAudioEffectManifest } from '~/effects';
import {
  getTransitionManifest,
  DEFAULT_TRANSITION_MODE,
  DEFAULT_TRANSITION_CURVE,
  normalizeTransitionParams,
} from '~/transitions';

interface UseClipDropOptions {
  track: Ref<TimelineTrack>;
  clipItem: Ref<TimelineClipItem | null>;
  canEditClipContent: Ref<boolean>;
  updateClipProperties: (
    trackId: string,
    itemId: string,
    patch: Record<string, unknown>,
  ) => void;
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
}

export function useClipDrop(options: UseClipDropOptions) {
  const isDraggingOver = ref(false);

  function hasSupportedDrop(e: DragEvent): boolean {
    return (
      Boolean(e.dataTransfer?.types.includes('fastcat-effect')) ||
      Boolean(e.dataTransfer?.types.includes('fastcat-transition'))
    );
  }

  function handleDragEnter(e: DragEvent) {
    if (options.canEditClipContent.value && hasSupportedDrop(e)) {
      isDraggingOver.value = true;
    }
  }

  function handleDragOver(e: DragEvent) {
    if (options.canEditClipContent.value && hasSupportedDrop(e)) {
      e.preventDefault();
    }
  }

  function handleDragLeave() {
    isDraggingOver.value = false;
  }

  function handleDrop(e: DragEvent) {
    isDraggingOver.value = false;
    const clip = options.clipItem.value;
    if (!options.canEditClipContent.value || !clip) return;

    const effectType = e.dataTransfer?.getData('fastcat-effect');
    const transitionType = e.dataTransfer?.getData('fastcat-transition');

    if (effectType) {
      _handleEffectDrop(clip, effectType);
    } else if (transitionType) {
      _handleTransitionDrop(e, clip, transitionType);
    }
  }

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
      effects: [newEffect, ...((clip as any).effects ?? [])],
    });
    options.selectTimelineItem(options.track.value.id, clip.id, 'clip');

    setTimeout(() => options.triggerScrollToEffects(), 50);
  }

  function _handleTransitionDrop(e: DragEvent, clip: TimelineClipItem, transitionType: string) {
    const manifest = getTransitionManifest(transitionType);
    if (!manifest) return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const edge: 'in' | 'out' = e.clientX - rect.left <= rect.width / 2 ? 'in' : 'out';

    const durationUs = Math.min(
      manifest.defaultDurationUs ?? 1_000_000,
      Math.round(clip.timelineRange.durationUs * 0.3),
    );

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
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  };
}
