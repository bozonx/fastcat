import { computed, type Ref } from 'vue';
import type { TimelineTrack, TimelineTrackItem, TimelineClipItem } from '~/timeline/types';
import type { UserSettings } from '~/types/settings.types';
import { isLayer1Active, isLayer2Active } from '~/utils/hotkeys/layerUtils';

export interface ClipInteractionsContext {
  track: Ref<TimelineTrack>;
  item: Ref<TimelineTrackItem>;
  canEditClipContent: Ref<boolean>;
  isTrimModeActive: Ref<boolean>;
  userSettings: Ref<UserSettings>;
  selectTimelineItems: (ids: string[]) => void;
  trimToPlayheadLeftNoRipple: (target: { trackId: string; itemId: string }) => void;
  trimToPlayheadRightNoRipple: (target: { trackId: string; itemId: string }) => void;
  splitClipAtPlayhead: (target: { trackId: string; itemId: string }) => void;
  emitSelectItem: (e: PointerEvent, itemId: string) => void;
  didStartDrag: Ref<boolean>;
}

export function useClipInteractions(ctx: ClipInteractionsContext) {
  const clipItem = computed<TimelineClipItem | null>(() =>
    ctx.item.value.kind === 'clip' ? (ctx.item.value as TimelineClipItem) : null,
  );

  function onClipClick(e: MouseEvent) {
    if (ctx.didStartDrag.value) return;

    if (ctx.isTrimModeActive.value) {
      if (
        e.button === 0 &&
        ctx.canEditClipContent.value &&
        clipItem.value &&
        !clipItem.value.locked
      ) {
        const isShift = isLayer1Active(e, ctx.userSettings.value);
        const isCtrl = isLayer2Active(e, ctx.userSettings.value);
        const target = {
          trackId: ctx.track.value.id,
          itemId: ctx.item.value.id,
        };

        ctx.selectTimelineItems([ctx.item.value.id]);

        if (isShift && !isCtrl) {
          ctx.trimToPlayheadLeftNoRipple(target);
        } else if (!isShift && isCtrl) {
          ctx.trimToPlayheadRightNoRipple(target);
        } else {
          ctx.splitClipAtPlayhead(target);
        }
      }
      return;
    }

    if (e.button === 0) {
      ctx.emitSelectItem(e as PointerEvent, ctx.item.value.id);
    }
  }

  return {
    clipItem,
    onClipClick,
  };
}
