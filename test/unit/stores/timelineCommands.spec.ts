import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { createTimelineCommands } from '~/stores/timeline/timelineCommands';
import type { TimelineDocument } from '~/timeline/types';

describe('timelineCommands', () => {
  let timelineDoc: any;
  let currentTimelinePath: any;
  let mediaMetadata: any;
  let applyTimeline: ReturnType<typeof vi.fn>;
  let createFallbackTimelineDoc: ReturnType<typeof vi.fn>;
  let getFileHandleByPath: ReturnType<typeof vi.fn>;
  let getFileByPath: ReturnType<typeof vi.fn>;
  let getOrFetchMetadataByPath: ReturnType<typeof vi.fn>;
  let getUserSettings: ReturnType<typeof vi.fn>;
  let getProjectSettings: ReturnType<typeof vi.fn>;
  let updateProjectSettings: ReturnType<typeof vi.fn>;
  let hasProxy: ReturnType<typeof vi.fn>;
  let ensureProxy: ReturnType<typeof vi.fn>;
  let openProjectSettings: ReturnType<typeof vi.fn>;
  let toast: any;
  let t: ReturnType<typeof vi.fn>;
  let commands: ReturnType<typeof createTimelineCommands>;

  beforeEach(() => {
    timelineDoc = ref<TimelineDocument | null>(null);
    currentTimelinePath = ref('/path/to/timeline');
    mediaMetadata = ref({});
    applyTimeline = vi.fn();
    createFallbackTimelineDoc = vi.fn().mockReturnValue({ tracks: [] });
    getFileHandleByPath = vi.fn().mockResolvedValue({});
    getFileByPath = vi.fn().mockResolvedValue({});
    getOrFetchMetadataByPath = vi.fn().mockResolvedValue({});
    getUserSettings = vi
      .fn()
      .mockReturnValue({ timeline: { defaultStaticClipDurationUs: 5000000 } });
    getProjectSettings = vi.fn().mockReturnValue({});
    updateProjectSettings = vi.fn().mockResolvedValue(undefined);
    hasProxy = vi.fn().mockReturnValue(false);
    ensureProxy = vi.fn().mockResolvedValue(undefined);
    openProjectSettings = vi.fn();
    toast = { add: vi.fn() };
    t = vi.fn((key) => key);

    commands = createTimelineCommands({
      timelineDoc,
      currentTimelinePath,
      mediaMetadata,
      applyTimeline,
      createFallbackTimelineDoc,
      getFileHandleByPath,
      getFileByPath,
      getOrFetchMetadataByPath,
      getUserSettings,
      getProjectSettings,
      updateProjectSettings,
      hasProxy,
      ensureProxy,
      openProjectSettings,
      toast,
      t,
    });
  });

  it('fails to add current timeline to itself', async () => {
    await expect(
      commands.addTimelineClipToTimelineFromPath({
        trackId: 'track1',
        name: 'nested',
        path: '/path/to/timeline',
      }),
    ).rejects.toThrow('Cannot insert the currently opened timeline into itself');
  });

  it('returns audio to video applies correct command', () => {
    commands.returnAudioToVideo({ videoItemId: 'clip1' });
    expect(applyTimeline).toHaveBeenCalledWith({
      type: 'return_audio_to_video',
      videoItemId: 'clip1',
    });
  });
});
