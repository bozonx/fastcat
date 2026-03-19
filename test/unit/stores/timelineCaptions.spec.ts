import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { createTimelineCaptions } from '~/stores/timeline/timelineCaptions';
import type { TimelineDocument } from '~/timeline/types';

describe('timelineCaptions', () => {
  let timelineDoc: any;
  let clips: any;
  let requestTimelineSave: ReturnType<typeof vi.fn>;
  let getWorkspaceHandle: ReturnType<typeof vi.fn>;
  let getResolvedStorageTopology: ReturnType<typeof vi.fn>;
  let getCurrentProjectId: ReturnType<typeof vi.fn>;
  let captions: ReturnType<typeof createTimelineCaptions>;

  beforeEach(() => {
    timelineDoc = ref<TimelineDocument | null>({
      tracks: [
        { 
          id: 'track1', 
          kind: 'video', 
          videoHidden: false,
          audioMuted: false,
          items: [] 
        }
      ],
    } as any);
    
    clips = {
      addVirtualClipToTrack: vi.fn(),
    };
    
    requestTimelineSave = vi.fn().mockResolvedValue(undefined);
    getWorkspaceHandle = vi.fn().mockReturnValue({});
    getResolvedStorageTopology = vi.fn().mockReturnValue({});
    getCurrentProjectId = vi.fn().mockReturnValue('project-1');

    captions = createTimelineCaptions({
      timelineDoc,
      clips,
      requestTimelineSave,
      getWorkspaceHandle,
      getResolvedStorageTopology,
      getCurrentProjectId,
    });
  });

  it('fails to generate captions if timeline not loaded', async () => {
    timelineDoc.value = null;
    await expect(captions.generateCaptionsFromTimeline({ 
      trackId: 'track1', 
      settings: {} as any 
    })).rejects.toThrow('Timeline not loaded');
  });

  it('fails to generate captions on non-existent track', async () => {
    await expect(captions.generateCaptionsFromTimeline({ 
      trackId: 'track2', 
      settings: {} as any 
    })).rejects.toThrow('Captions can only be generated on a video track');
  });

  it('fails to generate captions on track with items', async () => {
    timelineDoc.value!.tracks[0].items.push({ kind: 'clip', id: 'clip1' } as any);
    await expect(captions.generateCaptionsFromTimeline({ 
      trackId: 'track1', 
      settings: {} as any 
    })).rejects.toThrow('Select an empty video track for generated captions');
  });
});
