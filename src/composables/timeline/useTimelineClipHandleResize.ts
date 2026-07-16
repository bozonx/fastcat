import { onBeforeUnmount, ref } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineSettingsStore } from '~/stores/timeline-settings.store';
import { TICKS_PER_SECOND } from '~/utils/time';
import { cloneValue } from '~/utils/clone';
import { clipGainToYPercent, clipYPercentToGain } from '~/utils/audio';
import {
  pxToDeltaTicks,
  pickBestSnapCandidateTicks,
  zoomToPxPerSecond,
} from '~/utils/timeline/geometry';
import type {
  TimelineTrack,
  TimelineClipItem,
  TimelineDocument,
  ClipTransition,
  TimelineResizeFadePayload,
  TimelineResizeVolumePayload,
} from '~/timeline/types';
import { isLayer1Active } from '~/utils/hotkeys/layerUtils';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useTimelinePointerSession } from '~/composables/timeline/useTimelinePointerSession';
import { useEffectiveHotkeys } from '~/composables/editor/hotkeys/useEffectiveHotkeys';
import { isCommandMatched } from '~/utils/hotkeys/runtime';
import {
  computeMaxResizableTransitionDurationTicks as computeMaxResizableTransitionDurationUsPure,
  computeTransitionHandleSnapDurationTicks as computeTransitionHandleSnapDurationUsPure,
} from '~/composables/timeline/transitionResizeGeometry';

interface ClipResizeFields {
  audioFadeInTicks?: number;
  audioFadeOutTicks?: number;
  sourceDurationTicks?: number;
  transitionIn?: ClipTransition | null;
  transitionOut?: ClipTransition | null;
}

/**
 * Drives the in-clip adjustment handles — audio fade triangles, transition
 * handles and the volume line. This is NOT trimming of the clip's duration;
 * edge trim/slip/move live in `useTimelineItemDrag`.
 */
export function useTimelineClipHandleResize(
  getScrollLeft: () => number,
  tracksRef: () => TimelineTrack[],
) {
  const timelineStore = useTimelineStore();
  const projectStore = useProjectStore();
  const timelineSettingsStore = useTimelineSettingsStore();
  const workspaceStore = useWorkspaceStore();
  const { bindSession, clearSession, scheduleUpdate } = useTimelinePointerSession();

  const { hotkeyLookup, defaultHotkeyLookup } = useEffectiveHotkeys();

  function getClipResizeFields(item: TimelineClipItem): ClipResizeFields {
    return item as TimelineClipItem & ClipResizeFields;
  }

  function canEditClipContent(): boolean {
    return (
      projectStore.currentView === 'cut' ||
      projectStore.currentView === 'files' ||
      projectStore.currentView === 'sound'
    );
  }

  /** Minimum visible width in pixels before a transition is removed on drag release */
  const TRANSITION_DELETE_THRESHOLD_PX = 6;

  const resizeTransition = ref<{
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
    startX: number;
    startDurationTicks: number;
    lastDurationTicks: number;
    shouldDelete: boolean;
    hasMoved: boolean;
    isCreating: boolean;
    docBeforeDrag: TimelineDocument | null;
    startScrollLeft: number;
  } | null>(null);

  const resizeFade = ref<{
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
    startX: number;
    startFadeTicks: number;
    startCurve: 'linear' | 'logarithmic';
    activeCurve: 'linear' | 'logarithmic';
    startScrollLeft: number;
  } | null>(null);

  const resizeVolume = ref<{
    trackId: string;
    itemId: string;
    startY: number;
    startGain: number;
    trackHeight: number;
  } | null>(null);

  function startResizeVolume(e: PointerEvent, payload: TimelineResizeVolumePayload) {
    if (!canEditClipContent()) return;
    e.stopPropagation();
    e.preventDefault();

    const docBeforeDrag = cloneValue(timelineStore.timelineDoc);

    resizeVolume.value = {
      trackId: payload.trackId,
      itemId: payload.itemId,
      startY: e.clientY,
      startGain: payload.gain,
      trackHeight: payload.trackHeight,
    };

    clearSession();

    function onPointerMove(ev: PointerEvent) {
      if (!resizeVolume.value) return;
      const dy = ev.clientY - resizeVolume.value.startY;
      const startYPercent = clipGainToYPercent(resizeVolume.value.startGain);
      const deltaYPercent = (dy / resizeVolume.value.trackHeight) * 100;
      const newYPercent = Math.max(0, Math.min(100, startYPercent + deltaYPercent));
      const newVol = clipYPercentToGain(newYPercent);

      scheduleUpdate(() => {
        timelineStore.updateClipProperties(
          payload.trackId,
          payload.itemId,
          {
            audioGain: newVol,
            audioMuted: false,
          },
          {
            skipHistory: true,
            saveMode: 'none',
          },
        );
      });
    }

    function onPointerUp() {
      if (resizeVolume.value) {
        if (docBeforeDrag) {
          timelineStore.pushTimelineHistory(
            docBeforeDrag,
            'update_clip_properties',
            'videoEditor.fileManager.history.entries.updateClipGain',
          );
        }
        timelineStore.requestTimelineSave({ immediate: true });
      }
      resizeVolume.value = null;
      clearSession();
    }

    function onKeyDown(ev: KeyboardEvent) {
      const isCancel = isCommandMatched({
        event: ev,
        cmdId: 'general.deselect',
        userSettings: workspaceStore.userSettings,
        hotkeyLookup: hotkeyLookup.value,
        defaultHotkeyLookup: defaultHotkeyLookup.value,
      });

      if (isCancel && resizeVolume.value) {
        timelineStore.updateClipProperties(
          payload.trackId,
          payload.itemId,
          {
            audioGain: resizeVolume.value.startGain,
          },
          {
            skipHistory: true,
            saveMode: 'none',
          },
        );
        resizeVolume.value = null;
        clearSession();
      }
    }

    bindSession({
      onPointerMove,
      onPointerUp,
      onKeyDown,
    });
  }

  function startResizeFade(e: PointerEvent, payload: TimelineResizeFadePayload) {
    if (!canEditClipContent()) return;
    e.stopPropagation();
    e.preventDefault();

    const tracks = tracksRef();
    const track = tracks.find((t) => t.id === payload.trackId);
    const item = track?.items.find((i) => i.id === payload.itemId);
    if (!item || item.kind !== 'clip') return;

    const docBeforeDrag = cloneValue(timelineStore.timelineDoc);

    const curveProp = payload.edge === 'in' ? 'audioFadeInCurve' : 'audioFadeOutCurve';
    const startCurve = item[curveProp] === 'logarithmic' ? 'logarithmic' : 'linear';

    resizeFade.value = {
      trackId: payload.trackId,
      itemId: payload.itemId,
      edge: payload.edge,
      startX: e.clientX,
      startFadeTicks: payload.durationTicks,
      startCurve,
      activeCurve: startCurve,
      startScrollLeft: getScrollLeft(),
    };

    clearSession();

    function onPointerMove(ev: PointerEvent) {
      if (!resizeFade.value) return;
      const currentScrollLeft = getScrollLeft();
      const dx =
        ev.clientX -
        resizeFade.value.startX +
        (currentScrollLeft - resizeFade.value.startScrollLeft);
      const sign = payload.edge === 'in' ? 1 : -1;
      const deltaPx = dx * sign;
      const deltaTicks = pxToDeltaTicks(deltaPx, timelineStore.timelineZoom);

      const tracks = tracksRef();
      const track = tracks.find((t) => t.id === payload.trackId);
      const item = track?.items.find((i) => i.id === payload.itemId);
      if (!item || item.kind !== 'clip') return;

      const clipDurationTicks = Math.max(0, Math.round(item.timelineRange.durationTicks));
      const clipFields = getClipResizeFields(item);
      const oppFadeTicks = Math.max(
        0,
        Math.round(
          payload.edge === 'in'
            ? (clipFields.audioFadeOutTicks ?? 0)
            : (clipFields.audioFadeInTicks ?? 0),
        ),
      );
      const maxTicks = Math.max(0, clipDurationTicks - oppFadeTicks);
      let newFadeTicks = resizeFade.value.startFadeTicks + deltaTicks;
      newFadeTicks = Math.max(0, Math.min(maxTicks, newFadeTicks));

      if (timelineSettingsStore.toolbarSnapMode === 'snap') {
        const thresholdTicks = Math.round(
          (timelineSettingsStore.snapThresholdPx / zoomToPxPerSecond(timelineStore.timelineZoom)) *
            TICKS_PER_SECOND,
        );

        const edgeTicks =
          payload.edge === 'in'
            ? item.timelineRange.startTicks + newFadeTicks
            : item.timelineRange.startTicks + item.timelineRange.durationTicks - newFadeTicks;

        const targets = [];
        if (workspaceStore.userSettings.timeline.snapping.playhead) {
          targets.push(timelineStore.currentTime);
        }

        const snap = pickBestSnapCandidateTicks({
          rawTicks: edgeTicks,
          thresholdTicks,
          targetsTicks: targets,
        });

        if (snap.distTicks < thresholdTicks) {
          if (payload.edge === 'in') {
            newFadeTicks = Math.max(0, snap.snappedTicks - item.timelineRange.startTicks);
          } else {
            newFadeTicks = Math.max(
              0,
              item.timelineRange.startTicks + item.timelineRange.durationTicks - snap.snappedTicks,
            );
          }
          newFadeTicks = Math.min(maxTicks, newFadeTicks);
        }
      }

      const propName = payload.edge === 'in' ? 'audioFadeInTicks' : 'audioFadeOutTicks';
      const nextCurve = isLayer1Active(ev, workspaceStore.userSettings)
        ? resizeFade.value.startCurve === 'logarithmic'
          ? 'linear'
          : 'logarithmic'
        : resizeFade.value.startCurve;
      const curveChanged = nextCurve !== resizeFade.value.activeCurve;
      const curveProp = payload.edge === 'in' ? 'audioFadeInCurve' : 'audioFadeOutCurve';

      resizeFade.value.activeCurve = nextCurve;
      const nextFadeTicks = Math.round(newFadeTicks);
      scheduleUpdate(() => {
        timelineStore.updateClipProperties(
          payload.trackId,
          payload.itemId,
          {
            [propName]: nextFadeTicks,
            ...(curveChanged ? { [curveProp]: nextCurve } : {}),
          },
          {
            skipHistory: true,
            saveMode: 'none',
          },
        );
      });
    }

    function onPointerUp() {
      if (resizeFade.value) {
        if (docBeforeDrag) {
          timelineStore.pushTimelineHistory(
            docBeforeDrag,
            'update_clip_properties',
            'videoEditor.fileManager.history.entries.updateClipProperties',
          );
        }
        timelineStore.requestTimelineSave({ immediate: true });
      }
      resizeFade.value = null;
      clearSession();
    }

    function onKeyDown(ev: KeyboardEvent) {
      const isCancel = isCommandMatched({
        event: ev,
        cmdId: 'general.deselect',
        userSettings: workspaceStore.userSettings,
        hotkeyLookup: hotkeyLookup.value,
        defaultHotkeyLookup: defaultHotkeyLookup.value,
      });

      if (isCancel && resizeFade.value) {
        const propName = payload.edge === 'in' ? 'audioFadeInTicks' : 'audioFadeOutTicks';
        const curveProp = payload.edge === 'in' ? 'audioFadeInCurve' : 'audioFadeOutCurve';
        timelineStore.updateClipProperties(
          payload.trackId,
          payload.itemId,
          {
            [propName]: resizeFade.value.startFadeTicks,
            [curveProp]: resizeFade.value.startCurve,
          },
          {
            skipHistory: true,
            saveMode: 'none',
          },
        );
        resizeFade.value = null;
        clearSession();
      }
    }

    bindSession({
      onPointerMove,
      onPointerUp,
      onKeyDown,
    });
  }

  // Transition-handle geometry lives in `transitionResizeGeometry.ts` as pure
  // functions; these wrappers just supply the current track list.
  function computeMaxResizableTransitionDurationTicks(input: {
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
    currentTransition: ClipTransition;
  }): number {
    return computeMaxResizableTransitionDurationUsPure({ tracks: tracksRef(), ...input });
  }

  function computeTransitionHandleSnapDurationTicks(input: {
    trackId: string;
    itemId: string;
    edge: 'in' | 'out';
    currentTransition: ClipTransition;
    rawDurationTicks: number;
  }): number | null {
    return computeTransitionHandleSnapDurationUsPure({ tracks: tracksRef(), ...input });
  }

  function startResizeTransition(e: PointerEvent, payload: TimelineResizeFadePayload) {
    if (!canEditClipContent()) return;
    e.stopPropagation();
    e.preventDefault();

    const isCreating = payload.durationTicks === 0;
    // Clone upfront so the snapshot remains a faithful pre-drag copy even if a
    // future command mutates the doc in place.
    const docBeforeDrag = payload.docBeforeDrag ?? cloneValue(timelineStore.timelineDoc);
    const deleteThresholdTicks = Math.max(
      0,
      pxToDeltaTicks(TRANSITION_DELETE_THRESHOLD_PX, timelineStore.timelineZoom),
    );

    resizeTransition.value = {
      trackId: payload.trackId,
      itemId: payload.itemId,
      edge: payload.edge,
      startX: payload.pointerStartClientX ?? e.clientX,
      startDurationTicks: payload.durationTicks,
      lastDurationTicks: payload.durationTicks,
      shouldDelete: payload.durationTicks < deleteThresholdTicks,
      hasMoved: false,
      isCreating,
      docBeforeDrag,
      startScrollLeft: getScrollLeft(),
    };

    clearSession();

    function onPointerMove(ev: PointerEvent) {
      if (!resizeTransition.value) return;
      const currentScrollLeft = getScrollLeft();
      const dx =
        ev.clientX -
        resizeTransition.value.startX +
        (currentScrollLeft - resizeTransition.value.startScrollLeft);
      const sign = payload.edge === 'in' ? 1 : -1;
      const deltaPx = resizeTransition.value.isCreating ? Math.abs(dx) : dx * sign;
      const deltaTicks = pxToDeltaTicks(deltaPx, timelineStore.timelineZoom);

      const tracks = tracksRef();
      const track = tracks.find((t) => t.id === payload.trackId);
      const item = track?.items.find((i) => i.id === payload.itemId);
      if (!item || item.kind !== 'clip') return;

      const current = payload.edge === 'in' ? item.transitionIn : item.transitionOut;
      if (!current) return;

      const maxUsRaw = computeMaxResizableTransitionDurationTicks({
        trackId: payload.trackId,
        itemId: payload.itemId,
        edge: payload.edge,
        currentTransition: current,
      });

      const clipDurationTicks = Math.max(0, Math.round(item.timelineRange.durationTicks));
      const oppositeTransitionTicks = Math.max(
        0,
        Math.round(
          payload.edge === 'in'
            ? (item.transitionOut?.durationTicks ?? 0)
            : (item.transitionIn?.durationTicks ?? 0),
        ),
      );
      const hardMaxTicks = Math.max(0, clipDurationTicks - oppositeTransitionTicks);

      let newDurationTicks = Math.min(
        Math.max(0, resizeTransition.value.startDurationTicks + deltaTicks),
        hardMaxTicks,
        maxUsRaw,
      );

      if (timelineSettingsStore.toolbarSnapMode === 'snap') {
        const snapThresholdTicks = Math.round(
          (timelineSettingsStore.snapThresholdPx / zoomToPxPerSecond(timelineStore.timelineZoom)) *
            TICKS_PER_SECOND,
        );

        const edgeTicks =
          payload.edge === 'in'
            ? item.timelineRange.startTicks + newDurationTicks
            : item.timelineRange.startTicks + item.timelineRange.durationTicks - newDurationTicks;

        const targets = [];
        if (workspaceStore.userSettings.timeline.snapping.playhead) {
          targets.push(timelineStore.currentTime);
        }

        const handleSnapTicks = computeTransitionHandleSnapDurationTicks({
          trackId: payload.trackId,
          itemId: payload.itemId,
          edge: payload.edge,
          currentTransition: current,
          rawDurationTicks: newDurationTicks,
        });

        if (handleSnapTicks !== null) {
          targets.push(
            payload.edge === 'in'
              ? item.timelineRange.startTicks + handleSnapTicks
              : item.timelineRange.startTicks + item.timelineRange.durationTicks - handleSnapTicks,
          );
        }

        const snap = pickBestSnapCandidateTicks({
          rawTicks: edgeTicks,
          thresholdTicks: snapThresholdTicks,
          targetsTicks: targets,
        });

        if (snap.distTicks < snapThresholdTicks) {
          if (payload.edge === 'in') {
            newDurationTicks = Math.max(0, snap.snappedTicks - item.timelineRange.startTicks);
          } else {
            newDurationTicks = Math.max(
              0,
              item.timelineRange.startTicks + item.timelineRange.durationTicks - snap.snappedTicks,
            );
          }
          newDurationTicks = Math.min(hardMaxTicks, maxUsRaw, newDurationTicks);
        }
      }

      const currentDeleteThresholdTicks = Math.max(
        0,
        pxToDeltaTicks(TRANSITION_DELETE_THRESHOLD_PX, timelineStore.timelineZoom),
      );

      resizeTransition.value.lastDurationTicks = newDurationTicks;
      resizeTransition.value.shouldDelete = newDurationTicks < currentDeleteThresholdTicks;
      resizeTransition.value.hasMoved = true;

      if (maxUsRaw <= 0 && newDurationTicks <= 0) {
        resizeTransition.value.shouldDelete = true;
        return;
      }

      const transitionPatch =
        payload.edge === 'in'
          ? {
              transitionIn: {
                ...current,
                durationTicks: Math.round(newDurationTicks),
              } as ClipTransition,
            }
          : {
              transitionOut: {
                ...current,
                durationTicks: Math.round(newDurationTicks),
              } as ClipTransition,
            };
      scheduleUpdate(() => {
        timelineStore.updateClipTransition(payload.trackId, payload.itemId, transitionPatch, {
          skipHistory: true,
          saveMode: 'none',
        });
      });
    }

    function onPointerUp() {
      const state = resizeTransition.value;
      resizeTransition.value = null;
      clearSession();

      if (!state) return;

      const {
        shouldDelete,
        docBeforeDrag: doc,
        isCreating: creating,
        hasMoved,
        lastDurationTicks,
      } = state;

      if (!hasMoved && !creating) {
        timelineStore.historyDebounce.flushPendingDebouncedHistory();
        return;
      }

      if (shouldDelete) {
        timelineStore.updateClipTransition(
          payload.trackId,
          payload.itemId,
          payload.edge === 'in' ? { transitionIn: null } : { transitionOut: null },
          { skipHistory: true, saveMode: 'none' },
        );
        // Record history only when deleting an already-existing transition (not ephemeral create)
        if (!creating && doc) {
          timelineStore.pushTimelineHistory(
            doc,
            'update_clip_transition',
            'videoEditor.fileManager.history.entries.updateTransition',
          );
        } else {
          timelineStore.historyDebounce.flushPendingDebouncedHistory();
        }
      } else {
        // Apply final duration explicitly (pending scheduleUpdate was cancelled by clearSession)
        const tracks = tracksRef();
        const track = tracks.find((t) => t.id === payload.trackId);
        const item = track?.items.find((i) => i.id === payload.itemId);
        if (item && item.kind === 'clip') {
          const current = payload.edge === 'in' ? item.transitionIn : item.transitionOut;
          if (current) {
            const finalPatch =
              payload.edge === 'in'
                ? ({
                    transitionIn: {
                      ...current,
                      durationTicks: Math.round(lastDurationTicks),
                    },
                  } as { transitionIn: ClipTransition })
                : ({
                    transitionOut: {
                      ...current,
                      durationTicks: Math.round(lastDurationTicks),
                    },
                  } as { transitionOut: ClipTransition });
            timelineStore.updateClipTransition(payload.trackId, payload.itemId, finalPatch, {
              skipHistory: true,
              saveMode: 'none',
            });
          }
        }
        if (doc) {
          timelineStore.pushTimelineHistory(
            doc,
            'update_clip_transition',
            'videoEditor.fileManager.history.entries.updateTransition',
          );
        } else {
          timelineStore.historyDebounce.flushPendingDebouncedHistory();
        }
      }

      timelineStore.requestTimelineSave({ immediate: true });
    }

    function onKeyDown(ev: KeyboardEvent) {
      const isCancel = isCommandMatched({
        event: ev,
        cmdId: 'general.deselect',
        userSettings: workspaceStore.userSettings,
        hotkeyLookup: hotkeyLookup.value,
        defaultHotkeyLookup: defaultHotkeyLookup.value,
      });

      if (isCancel && resizeTransition.value) {
        const state = resizeTransition.value;
        resizeTransition.value = null;
        clearSession();
        timelineStore.historyDebounce.clearPendingDebouncedHistory();

        if (state.isCreating) {
          // Remove the just-created transition without recording history
          timelineStore.updateClipTransition(
            payload.trackId,
            payload.itemId,
            payload.edge === 'in' ? { transitionIn: null } : { transitionOut: null },
            { skipHistory: true, saveMode: 'none' },
          );
        } else {
          // Restore original duration without recording history
          const tracks = tracksRef();
          const track = tracks.find((t) => t.id === payload.trackId);
          const item = track?.items.find((i) => i.id === payload.itemId);
          if (item && item.kind === 'clip') {
            const current = payload.edge === 'in' ? item.transitionIn : item.transitionOut;
            if (current) {
              const restorePatch =
                payload.edge === 'in'
                  ? ({
                      transitionIn: {
                        ...current,
                        durationTicks: state.startDurationTicks,
                      },
                    } as { transitionIn: ClipTransition })
                  : ({
                      transitionOut: {
                        ...current,
                        durationTicks: state.startDurationTicks,
                      },
                    } as { transitionOut: ClipTransition });
              timelineStore.updateClipTransition(payload.trackId, payload.itemId, restorePatch, {
                skipHistory: true,
                saveMode: 'none',
              });
            }
          }
        }
      }
    }

    bindSession({
      onPointerMove,
      onPointerUp,
      onKeyDown,
    });

    if (
      typeof payload.pointerStartClientX === 'number' &&
      payload.pointerStartClientX !== e.clientX
    ) {
      onPointerMove(e);
    }
  }

  onBeforeUnmount(() => {
    clearSession();
    resizeTransition.value = null;
    resizeFade.value = null;
    resizeVolume.value = null;
  });

  return {
    resizeTransition,
    resizeFade,
    resizeVolume,
    startResizeVolume,
    startResizeFade,
    startResizeTransition,
  };
}
