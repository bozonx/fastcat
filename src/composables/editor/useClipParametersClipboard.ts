import { computed, onScopeDispose, ref, type Ref } from 'vue';
import { useAppClipboard } from '~/composables/useAppClipboard';
import {
  buildClipParametersPatch,
  createClipParametersSnapshot,
  getApplicableClipParameterGroups,
  hasClipParametersPatch,
} from '~/utils/timeline/clip-parameters';
import type { ClipParametersApplyTarget } from '~/utils/timeline/clip-parameters';
import type { TimelineCommand } from '~/timeline/commands';
import type { TimelineClipItem, TrackKind } from '~/timeline/types';

export interface UseClipParametersClipboardOptions {
  clip: Ref<TimelineClipItem>;
  trackKind: Ref<TrackKind>;
  /**
   * Expands the paste target into the full list of clips the parameters should be
   * applied to. When several clips are selected this returns all of them so a
   * single paste fans out across the whole selection; otherwise just the target.
   */
  resolveApplyTargets: (target: ClipParametersApplyTarget) => ClipParametersApplyTarget[];
  /** Applies a batch of timeline commands as a single, atomic undo entry. */
  applyCommands: (cmds: TimelineCommand[]) => void;
}

export function useClipParametersClipboard(options: UseClipParametersClipboardOptions) {
  const clipboardStore = useAppClipboard();

  const isPasteParametersModalOpen = ref(false);
  const selectedParameterGroups = ref<string[]>([]);
  const pasteParametersTarget = ref<{ clip: TimelineClipItem; trackKind: TrackKind } | null>(null);

  // When the paste action is triggered from a context menu / dropdown, Reka closes
  // that menu in a microtask (`await nextTick()`) *after* our `onSelect` handler has
  // already run. Opening the dialog synchronously (or on a microtask) therefore mounts
  // it underneath the still-closing menu layer, and the first attempt to dismiss the
  // dialog gets swallowed by the lingering layer — the modal appears to "reopen" and
  // only closes on the second try. Deferring the open to a macrotask guarantees the
  // dialog mounts on a clean overlay stack, after the menu has fully closed.
  let openTimeout: ReturnType<typeof setTimeout> | null = null;

  function queueOpenPasteParametersModal() {
    if (openTimeout !== null) clearTimeout(openTimeout);
    openTimeout = setTimeout(() => {
      openTimeout = null;
      isPasteParametersModalOpen.value = true;
    }, 0);
  }

  onScopeDispose(() => {
    if (openTimeout !== null) clearTimeout(openTimeout);
  });

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
    const initialSelected: string[] = [];
    for (const group of groups) {
      if (group.selectedByDefault) {
        initialSelected.push(group.id);
        if (group.subProperties) {
          for (const sub of group.subProperties) {
            initialSelected.push(sub.id);
          }
        }
      }
    }
    selectedParameterGroups.value = initialSelected;
    queueOpenPasteParametersModal();
  }

  function applyClipParameters(groups: string[]) {
    const payload = clipboardStore.clipboardPayload;
    if (!payload || payload.source !== 'clipParameters') return;

    const primary = pasteParametersTarget.value ?? {
      clip: options.clip.value,
      trackKind: options.trackKind.value,
    };
    const targets = options.resolveApplyTargets({
      trackId: primary.clip.trackId,
      trackKind: primary.trackKind,
      clip: primary.clip,
    });
    if (targets.length === 0) return;

    // Build one atomic batch spanning every selected clip and both property and
    // transition edits, so a multi-clip paste collapses into a single undo entry.
    // The patch is rebuilt per target so each clip only receives the groups that
    // actually apply to it (e.g. text-only props are dropped for a video clip).
    const cmds: TimelineCommand[] = [];
    for (const target of targets) {
      const patch = buildClipParametersPatch({
        snapshot: payload.snapshot,
        targetClip: target.clip,
        targetTrackKind: target.trackKind,
        groups,
      });
      if (!hasClipParametersPatch(patch)) continue;

      if (Object.keys(patch.properties).length > 0) {
        cmds.push({
          type: 'update_clip_properties',
          trackId: target.trackId,
          itemId: target.clip.id,
          properties: patch.properties,
        });
      }

      const hasTransitionIn = Object.prototype.hasOwnProperty.call(patch, 'transitionIn');
      const hasTransitionOut = Object.prototype.hasOwnProperty.call(patch, 'transitionOut');
      if (hasTransitionIn || hasTransitionOut) {
        cmds.push({
          type: 'update_clip_transition',
          trackId: target.trackId,
          itemId: target.clip.id,
          ...(hasTransitionIn ? { transitionIn: patch.transitionIn } : {}),
          ...(hasTransitionOut ? { transitionOut: patch.transitionOut } : {}),
        });
      }
    }

    if (cmds.length === 0) return;
    options.applyCommands(cmds);
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
