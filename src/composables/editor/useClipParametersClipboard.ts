import { computed, ref, type Ref } from 'vue';
import { useAppClipboard } from '~/composables/useAppClipboard';
import {
  buildClipParametersPatch,
  createClipParametersSnapshot,
  getApplicableClipParameterGroups,
  hasClipParametersPatch,
} from '~/utils/timeline/clip-parameters';
import type { ClipParameterGroup, ClipParametersPatch } from '~/utils/timeline/clip-parameters';
import type { TimelineClipItem, TrackKind } from '~/timeline/types';

export interface UseClipParametersClipboardOptions {
  clip: Ref<TimelineClipItem>;
  trackKind: Ref<TrackKind>;
  updateClipProperties: (trackId: string, itemId: string, props: Record<string, unknown>) => void;
  updateClipTransition: (
    trackId: string,
    itemId: string,
    patch: {
      transitionIn?: ClipParametersPatch['transitionIn'];
      transitionOut?: ClipParametersPatch['transitionOut'];
    },
  ) => void;
}

export function useClipParametersClipboard(options: UseClipParametersClipboardOptions) {
  const clipboardStore = useAppClipboard();

  const isPasteParametersModalOpen = ref(false);
  const selectedParameterGroups = ref<ClipParameterGroup[]>([]);
  const pasteParametersTarget = ref<{ clip: TimelineClipItem; trackKind: TrackKind } | null>(null);

  const clipParameterGroupOptions = computed(() => {
    const payload = clipboardStore.clipboardPayload;
    const target = pasteParametersTarget.value;
    if (!payload || payload.source !== 'clipParameters' || !target) return [];
    return getApplicableClipParameterGroups({
      snapshot: payload.snapshot,
      targetClip: target.clip,
      targetTrackKind: target.trackKind,
    });
  });

  const hasApplicableClipParameters = computed(() => {
    const payload = clipboardStore.clipboardPayload;
    if (!payload || payload.source !== 'clipParameters') return false;
    return (
      getApplicableClipParameterGroups({
        snapshot: payload.snapshot,
        targetClip: options.clip.value,
        targetTrackKind: options.trackKind.value,
      }).length > 0
    );
  });

  function copyClipParameters(clip?: TimelineClipItem, trackKind?: TrackKind) {
    const c = clip ?? options.clip.value;
    const tk = trackKind ?? options.trackKind.value;

    clipboardStore.setClipboardPayload({
      source: 'clipParameters',
      snapshot: createClipParametersSnapshot({ clip: c, trackKind: tk }),
    });
  }

  function openPasteClipParameters(clip?: TimelineClipItem, trackKind?: TrackKind) {
    const c = clip ?? options.clip.value;
    const tk = trackKind ?? options.trackKind.value;

    const payload = clipboardStore.clipboardPayload;
    if (!payload || payload.source !== 'clipParameters') return;

    const groups = getApplicableClipParameterGroups({
      snapshot: payload.snapshot,
      targetClip: c,
      targetTrackKind: tk,
    });
    if (groups.length === 0) return;

    pasteParametersTarget.value = { clip: c, trackKind: tk };
    selectedParameterGroups.value = groups
      .filter((group) => group.selectedByDefault)
      .map((group) => group.id);
    isPasteParametersModalOpen.value = true;
  }

  function applyClipParameters(groups: ClipParameterGroup[]) {
    const payload = clipboardStore.clipboardPayload;
    const target = pasteParametersTarget.value;
    if (!payload || payload.source !== 'clipParameters') return;

    const effectiveTarget = target ?? { clip: options.clip.value, trackKind: options.trackKind.value };

    const patch = buildClipParametersPatch({
      snapshot: payload.snapshot,
      targetClip: effectiveTarget.clip,
      targetTrackKind: effectiveTarget.trackKind,
      groups,
    });
    if (!hasClipParametersPatch(patch)) return;

    const { clip } = effectiveTarget;
    if (Object.keys(patch.properties).length > 0) {
      options.updateClipProperties(clip.trackId, clip.id, patch.properties);
    }
    if (
      Object.prototype.hasOwnProperty.call(patch, 'transitionIn') ||
      Object.prototype.hasOwnProperty.call(patch, 'transitionOut')
    ) {
      options.updateClipTransition(clip.trackId, clip.id, {
        ...(Object.prototype.hasOwnProperty.call(patch, 'transitionIn')
          ? { transitionIn: patch.transitionIn }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(patch, 'transitionOut')
          ? { transitionOut: patch.transitionOut }
          : {}),
      });
    }
  }

  return {
    isPasteParametersModalOpen,
    selectedParameterGroups,
    clipParameterGroupOptions,
    hasApplicableClipParameters,
    copyClipParameters,
    openPasteClipParameters,
    applyClipParameters,
  };
}
