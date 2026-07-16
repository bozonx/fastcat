import { DEFAULT_TRANSITION_CURVE, DEFAULT_TRANSITION_MODE } from '~/transitions';
import { TICKS_PER_SECOND } from '~/utils/time';
import type { TimelineClipItem } from '~/timeline/types';
import type { ContextMenuGroup, UseClipContextMenuOptions } from './types';

export function buildTransitionContextMenu(
  options: UseClipContextMenuOptions,
): ContextMenuGroup[] | null {
  const track = options.track.value;
  const item = options.item.value;

  if (item.kind !== 'clip' || track.kind !== 'video') return null;

  const clipItem = item as TimelineClipItem;
  const hasIn = Boolean(clipItem.transitionIn);
  const hasOut = Boolean(clipItem.transitionOut);
  const transitionGroup: ContextMenuGroup = [];
  const defaultTransitionDurationTicks = Math.max(
    0,
    Math.round(Number(options.defaultTransitionDurationTicks.value ?? TICKS_PER_SECOND)),
  );
  const clipDurationTicks = Math.max(0, Math.round(Number(clipItem.timelineRange?.durationTicks ?? 0)));
  const suggestedDurationTicks =
    clipDurationTicks > 0 && clipDurationTicks < defaultTransitionDurationTicks
      ? Math.round(clipDurationTicks * 0.3)
      : defaultTransitionDurationTicks;

  transitionGroup.push({
    label: hasIn
      ? options.t('fastcat.timeline.removeTransitionIn')
      : options.t('fastcat.timeline.addTransitionIn'),
    icon: hasIn ? 'i-heroicons-x-circle' : 'i-heroicons-arrow-left-end-on-rectangle',
    onSelect: () => {
      if (hasIn) {
        options.updateClipTransition(track.id, item.id, { transitionIn: null });
        options.clearSelection();
        return;
      }

      const transition = {
        type: 'dissolve' as const,
        durationTicks: suggestedDurationTicks,
        mode: DEFAULT_TRANSITION_MODE,
        curve: DEFAULT_TRANSITION_CURVE,
      };
      options.updateClipTransition(track.id, item.id, { transitionIn: transition });
      options.selectTransition({ trackId: track.id, itemId: item.id, edge: 'in' });
      options.selectTimelineTransition(track.id, item.id, 'in');
    },
  });

  transitionGroup.push({
    label: hasOut
      ? options.t('fastcat.timeline.removeTransitionOut')
      : options.t('fastcat.timeline.addTransitionOut'),
    icon: hasOut ? 'i-heroicons-x-circle' : 'i-heroicons-arrow-right-end-on-rectangle',
    onSelect: () => {
      if (hasOut) {
        options.updateClipTransition(track.id, item.id, { transitionOut: null });
        options.clearSelection();
        return;
      }

      const transition = {
        type: 'dissolve' as const,
        durationTicks: suggestedDurationTicks,
        mode: DEFAULT_TRANSITION_MODE,
        curve: DEFAULT_TRANSITION_CURVE,
      };
      options.updateClipTransition(track.id, item.id, { transitionOut: transition });
      options.selectTransition({ trackId: track.id, itemId: item.id, edge: 'out' });
      options.selectTimelineTransition(track.id, item.id, 'out');
    },
  });

  return transitionGroup.length > 0 ? [transitionGroup] : null;
}
