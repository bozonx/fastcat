/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useMobileTimelineVersion } from '~/composables/timeline/useMobileTimelineVersion';

const mockProjectStore = {
  listEntryNames: vi.fn(),
};

const mockTimelineStore = {
  currentTimelinePath: 'projects/foo/timeline.otio',
  previewBackupInfo: { id: 'backup-1' },
  getNextVersionName: vi.fn().mockResolvedValue('v2.otio'),
  createVersionFromBackup: vi.fn(),
};

const mockT = vi.fn((key: string, defaultValue?: string) => defaultValue || key);

describe('useMobileTimelineVersion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('lists sibling entries and proposes the next version name', async () => {
    mockProjectStore.listEntryNames.mockResolvedValue(['v1.otio']);

    const { isCreateVersionModalOpen, proposedVersionName, handleCreateVersionFromPreview } =
      useMobileTimelineVersion({
        timelineStore: mockTimelineStore as any,
        projectStore: mockProjectStore as any,
        t: mockT as any,
      });

    await handleCreateVersionFromPreview();

    expect(mockProjectStore.listEntryNames).toHaveBeenCalledWith('projects/foo');
    expect(mockTimelineStore.getNextVersionName).toHaveBeenCalled();
    expect(proposedVersionName.value).toBe('v2.otio');
    expect(isCreateVersionModalOpen.value).toBe(true);
  });

  it('uses an empty folder list when no timeline path is set', async () => {
    const store = { ...mockTimelineStore, currentTimelinePath: '' };

    const { proposedVersionName, handleCreateVersionFromPreview } = useMobileTimelineVersion({
      timelineStore: store as any,
      projectStore: mockProjectStore as any,
      t: mockT as any,
    });

    await handleCreateVersionFromPreview();

    expect(mockProjectStore.listEntryNames).not.toHaveBeenCalled();
    expect(proposedVersionName.value).toBe('v2.otio');
  });

  it('rejects empty names', () => {
    const { validateVersionName } = useMobileTimelineVersion({
      timelineStore: mockTimelineStore as any,
      projectStore: mockProjectStore as any,
      t: mockT as any,
    });

    expect(validateVersionName('   ')).toBe(false);
  });

  it('appends .otio extension and rejects duplicates', async () => {
    const store = { ...mockTimelineStore, currentTimelinePath: 'projects/foo/timeline.otio' };
    mockProjectStore.listEntryNames.mockResolvedValue(['existing.otio']);

    const { validateVersionName, handleCreateVersionFromPreview } = useMobileTimelineVersion({
      timelineStore: store as any,
      projectStore: mockProjectStore as any,
      t: mockT as any,
    });

    await handleCreateVersionFromPreview();

    expect(validateVersionName('new')).toBe(true);
    expect(validateVersionName('existing')).toBe('common.validation.exists');
  });

  it('creates version from backup and closes the modal', async () => {
    const { isCreateVersionModalOpen, handleConfirmCreateVersion } = useMobileTimelineVersion({
      timelineStore: mockTimelineStore as any,
      projectStore: mockProjectStore as any,
      t: mockT as any,
    });

    isCreateVersionModalOpen.value = true;
    await handleConfirmCreateVersion('v3.otio');

    expect(isCreateVersionModalOpen.value).toBe(false);
    expect(mockTimelineStore.createVersionFromBackup).toHaveBeenCalledWith(
      mockTimelineStore.previewBackupInfo,
      'v3.otio',
    );
  });
});
