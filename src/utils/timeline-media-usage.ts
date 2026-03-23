import type { TimelineDocument } from '~/timeline/types';

export interface TimelineUsageTimeline {
  timelinePath: string;
  timelineName: string;
  timelineDoc: TimelineDocument;
}

export interface MediaUsageTimelineRef {
  timelinePath: string;
  timelineName: string;
}

export type MediaPathToTimelinesMap = Record<string, MediaUsageTimelineRef[]>;

export function computeMediaUsageByTimelineDocs(timelines: TimelineUsageTimeline[]): {
  mediaPathToTimelines: MediaPathToTimelinesMap;
} {
  const mediaPathToTimelines: Record<string, MediaUsageTimelineRef[]> = {};

  for (const tl of timelines) {
    const seenInTimeline = new Set<string>();

    for (const track of tl.timelineDoc.tracks) {
      for (const item of track.items) {
        if (item.kind !== 'clip') continue;

        const mediaPaths: string[] = [];

        if (item.clipType === 'media' || item.clipType === 'timeline') {
          if (item.source?.path) {
            mediaPaths.push(item.source.path);
          }
        }

        if (item.clipType === 'hud') {
          if (item.background?.source?.path) {
            mediaPaths.push(item.background.source.path);
          }
          if (item.content?.source?.path) {
            mediaPaths.push(item.content.source.path);
          }
        }

        if (item.mask?.source?.path) {
          mediaPaths.push(item.mask.source.path);
        }

        for (const mediaPath of mediaPaths) {
          if (seenInTimeline.has(mediaPath)) continue;
          seenInTimeline.add(mediaPath);

          (mediaPathToTimelines[mediaPath] ??= []).push({
            timelinePath: tl.timelinePath,
            timelineName: tl.timelineName,
          });
        }
      }
    }
  }

  for (const mediaPath of Object.keys(mediaPathToTimelines)) {
    mediaPathToTimelines[mediaPath] = mediaPathToTimelines[mediaPath]!.slice().sort((a, b) =>
      a.timelineName.localeCompare(b.timelineName),
    );
  }

  return { mediaPathToTimelines };
}

export function getTimelinesUsingMediaPath(
  map: MediaPathToTimelinesMap,
  mediaPath: string,
): MediaUsageTimelineRef[] {
  return map[mediaPath] ?? [];
}
