import { computed, type Ref } from 'vue';

interface TimelineMediaUsageStoreLike {
  mediaPathToTimelines: Record<string, any[]>;
}

interface ProjectStoreLike {
  openTimelineFile: (path: string) => Promise<void>;
}

interface TimelineStoreLike {
  loadTimeline: () => Promise<void>;
  loadTimelineMetadata: () => Promise<void>;
}

interface UseFileTimelineUsageOptions {
  selectedFsEntry: Ref<any>;
  timelineMediaUsageStore: TimelineMediaUsageStoreLike;
  projectStore: ProjectStoreLike;
  timelineStore: TimelineStoreLike;
}

export function useFileTimelineUsage(options: UseFileTimelineUsageOptions) {
  const timelinesUsingSelectedFile = computed(() => {
    const entry = options.selectedFsEntry.value;
    if (!entry || entry.kind !== 'file' || !entry.path) return [];
    return options.timelineMediaUsageStore.mediaPathToTimelines[entry.path] ?? [];
  });

  async function openTimelineFromUsage(path: string) {
    await options.projectStore.openTimelineFile(path);
    await options.timelineStore.loadTimeline();
    void options.timelineStore.loadTimelineMetadata();
  }

  return {
    openTimelineFromUsage,
    timelinesUsingSelectedFile,
  };
}
