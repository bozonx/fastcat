import type { TimelineCommand } from '~/timeline/commands';
import type { TimelineClipItem } from '~/timeline/types';
import { quantizeTimeUsToFrames } from '~/timeline/commands/utils';

export function buildQuantizeClipCommands(input: {
  trackId: string;
  clip: TimelineClipItem;
  fps: number;
}): TimelineCommand[] {
  const startUs = quantizeTimeUsToFrames(input.clip.timelineRange.startUs, input.fps, 'round');
  const endUs = quantizeTimeUsToFrames(
    input.clip.timelineRange.startUs + input.clip.timelineRange.durationUs,
    input.fps,
    'round',
  );
  const durationUs = Math.max(1, endUs - startUs);

  return [
    {
      type: 'move_item',
      trackId: input.trackId,
      itemId: input.clip.id,
      startUs,
      quantizeToFrames: false,
    },
    {
      type: 'trim_item',
      trackId: input.trackId,
      itemId: input.clip.id,
      edge: 'end',
      deltaUs: durationUs - input.clip.timelineRange.durationUs,
      quantizeToFrames: false,
    },
  ];
}
