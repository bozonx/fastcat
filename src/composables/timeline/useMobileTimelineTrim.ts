import { ref, type ComputedRef, type Ref } from 'vue';

export interface TrimToolbarStartPayload {
  trackId: string;
  itemId: string;
  edge: 'start' | 'end';
  clientX: number;
  clientY: number;
}

export interface TrimToolbarPointerPayload {
  clientX: number;
  clientY: number;
}

export interface UseMobileTimelineTrimOptions {
  selectedClipContext: ComputedRef<{ clip: { timelineRange: { startUs: number } } } | null>;
  startTrimItem: (
    e: PointerEvent,
    input: { trackId: string; itemId: string; edge: 'start' | 'end'; startUs: number },
  ) => void;
  onGlobalPointerMove: (e: PointerEvent) => void;
  onGlobalPointerUp: (e?: PointerEvent) => void;
  draggingMode: Ref<string | null | false | undefined>;
}

export function useMobileTimelineTrim(options: UseMobileTimelineTrimOptions) {
  const {
    selectedClipContext,
    startTrimItem,
    onGlobalPointerMove,
    onGlobalPointerUp,
    draggingMode,
  } = options;

  // True while a trim is being driven by the fixed bottom trim toolbar. The
  // toolbar emits its own synthetic pointer events to drive the trim, but the
  // underlying real touch still bubbles pointer events up to the timeline root.
  // We must ignore those here: the finger sits at the very bottom of the screen
  // (on the toolbar), so feeding them to `updateEdgeScroll` would make the
  // timeline continuously auto-scroll down while the user slides.
  const isToolbarTrimActive = ref(false);

  function createSyntheticTouchPointerEvent(position: {
    clientX: number;
    clientY: number;
  }): PointerEvent {
    return new PointerEvent('pointermove', {
      button: 0,
      buttons: 1,
      clientX: position.clientX,
      clientY: position.clientY,
      pointerId: 1,
      pointerType: 'touch',
      bubbles: false,
      cancelable: false,
    });
  }

  function onTrimToolbarStart(payload: TrimToolbarStartPayload) {
    const clipContext = selectedClipContext.value;
    if (!clipContext) return;

    isToolbarTrimActive.value = true;
    startTrimItem(
      createSyntheticTouchPointerEvent({
        clientX: payload.clientX,
        clientY: payload.clientY,
      }),
      {
        trackId: payload.trackId,
        itemId: payload.itemId,
        edge: payload.edge,
        startUs: clipContext.clip.timelineRange.startUs,
      },
    );
  }

  function onTrimToolbarMove(payload: TrimToolbarPointerPayload) {
    if (!draggingMode.value) return;
    onGlobalPointerMove(
      createSyntheticTouchPointerEvent({
        clientX: payload.clientX,
        clientY: payload.clientY,
      }),
    );
  }

  function onTrimToolbarEnd(payload: TrimToolbarPointerPayload) {
    isToolbarTrimActive.value = false;
    if (!draggingMode.value) return;
    onGlobalPointerUp(
      createSyntheticTouchPointerEvent({
        clientX: payload.clientX,
        clientY: payload.clientY,
      }),
    );
  }

  return {
    isToolbarTrimActive,
    onTrimToolbarStart,
    onTrimToolbarMove,
    onTrimToolbarEnd,
  };
}
