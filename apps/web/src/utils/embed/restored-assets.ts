import type { TimelineDocument } from '~/timeline/types';

export function collectRestoredMediaPaths(timeline: TimelineDocument | null): Set<string> {
  const paths = new Set<string>();

  for (const track of timeline?.tracks ?? []) {
    for (const item of track.items) {
      const path = item.kind === 'clip' ? item.source?.path : undefined;
      if (path) paths.add(path);
    }
  }

  return paths;
}
