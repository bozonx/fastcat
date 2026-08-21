/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { collectRestoredMediaPaths } from '~/utils/embed/restored-assets';
import { createDefaultTimelineDocument } from '~/timeline/otio-serializer';

describe('collectRestoredMediaPaths', () => {
  it('collects unique source paths from restored clips', () => {
    const timeline = createDefaultTimelineDocument({
      id: 'timeline',
      name: 'Timeline',
      format: { width: 1920, height: 1080, fps: 30 },
    });
    timeline.tracks[0]!.items.push({
      id: 'clip-1',
      kind: 'clip',
      name: 'Restored clip',
      clipType: 'media',
      source: { path: '_video/asset-1.mp4' },
      timelineRange: { startTicks: 0, durationTicks: 1 },
      sourceRange: { startTicks: 0, durationTicks: 1 },
      sourceDurationTicks: 1,
    });

    expect(collectRestoredMediaPaths(timeline)).toEqual(new Set(['_video/asset-1.mp4']));
  });
});
