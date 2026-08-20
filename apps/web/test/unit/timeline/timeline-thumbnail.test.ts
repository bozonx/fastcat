/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineDocument } from '~/timeline/types';

const projectStoreMock = vi.hoisted(() => ({
  currentProjectId: 'project-1' as string | null,
  projectSettings: { project: { width: 1920, height: 1080, fps: 30 } },
}));
const workspaceStoreMock = vi.hoisted(() => ({ hasPersistentStorage: true }));
const extractTimelineFrameBlobMock = vi.hoisted(() => vi.fn());
const saveManualThumbnailMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const selectTimelineDurationTicksMock = vi.hoisted(() => vi.fn(() => 10_000_000));

vi.mock('~/stores/project.store', () => ({ useProjectStore: () => projectStoreMock }));
vi.mock('~/stores/workspace.store', () => ({ useWorkspaceStore: () => workspaceStoreMock }));
vi.mock('~/composables/useMediaProcessor', () => ({
  useMediaProcessor: () => ({ extractTimelineFrameBlob: extractTimelineFrameBlobMock }),
}));
vi.mock('~/utils/file-thumbnail-generator', () => ({
  fileThumbnailGenerator: { saveManualThumbnail: saveManualThumbnailMock },
}));
vi.mock('~/timeline/selectors', () => ({
  selectTimelineDurationTicks: selectTimelineDurationTicksMock,
}));

const timelineDoc = { timebase: { fps: 30 }, tracks: [] } as unknown as TimelineDocument;

describe('generateTimelineThumbnail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectStoreMock.currentProjectId = 'project-1';
    workspaceStoreMock.hasPersistentStorage = true;
    extractTimelineFrameBlobMock.mockResolvedValue(new Blob(['x'], { type: 'image/webp' }));
  });

  it('renders the timeline thumbnail at the cheapest effect-quality tier', async () => {
    const { generateTimelineThumbnail } = await import('~/timeline/timeline-thumbnail');

    generateTimelineThumbnail({ timelinePath: 'seq.otio', timelineDoc });
    // The generator runs its work in a fire-and-forget async IIFE.
    await vi.waitFor(() => expect(extractTimelineFrameBlobMock).toHaveBeenCalled());

    expect(extractTimelineFrameBlobMock).toHaveBeenCalledWith(
      expect.objectContaining({ effectQuality: 'low' }),
    );
    await vi.waitFor(() => expect(saveManualThumbnailMock).toHaveBeenCalled());
  });

  it('skips generation without a project id or persistent storage', async () => {
    const { generateTimelineThumbnail } = await import('~/timeline/timeline-thumbnail');

    projectStoreMock.currentProjectId = null;
    generateTimelineThumbnail({ timelinePath: 'seq.otio', timelineDoc });

    workspaceStoreMock.hasPersistentStorage = false;
    projectStoreMock.currentProjectId = 'project-1';
    generateTimelineThumbnail({ timelinePath: 'seq.otio', timelineDoc });

    // Give any (incorrectly scheduled) async work a chance to run.
    await Promise.resolve();
    expect(extractTimelineFrameBlobMock).not.toHaveBeenCalled();
  });
});
