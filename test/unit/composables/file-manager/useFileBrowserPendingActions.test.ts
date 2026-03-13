import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';

const uiStore = {
  pendingFsEntryRename: null as any,
  pendingFsEntryCreateTimeline: null as any,
  pendingFsEntryCreateMarkdown: null as any,
  pendingRemoteDownloadRequest: null as any,
};

vi.mock('~/stores/ui.store', () => ({ useUiStore: () => uiStore }));

import { useFileBrowserPendingActions } from '../../../../src/composables/fileManager/useFileBrowserPendingActions';

describe('useFileBrowserPendingActions', () => {
  beforeEach(() => {
    uiStore.pendingFsEntryRename = null;
    uiStore.pendingFsEntryCreateTimeline = null;
    uiStore.pendingFsEntryCreateMarkdown = null;
    uiStore.pendingRemoteDownloadRequest = null;
    vi.clearAllMocks();
  });

  it('triggers rename if entry is in current folder and clears state', async () => {
    const startRename = vi.fn();
    const folderEntries = ref([{ path: 'test.mp4' }]);
    
    useFileBrowserPendingActions({
      folderEntries: folderEntries as any,
      startRename,
      createTimelineInDirectory: vi.fn(),
      createMarkdownInDirectory: vi.fn(),
      handlePendingRemoteDownloadRequest: vi.fn(),
    });

    uiStore.pendingFsEntryRename = { path: 'test.mp4' };
    await nextTick();

    expect(startRename).toHaveBeenCalledWith({ path: 'test.mp4' });
    expect(uiStore.pendingFsEntryRename).toBeNull();
  });

  it('ignores rename if entry is not in current folder', async () => {
    const startRename = vi.fn();
    const folderEntries = ref([{ path: 'other.mp4' }]);
    
    useFileBrowserPendingActions({
      folderEntries: folderEntries as any,
      startRename,
      createTimelineInDirectory: vi.fn(),
      createMarkdownInDirectory: vi.fn(),
      handlePendingRemoteDownloadRequest: vi.fn(),
    });

    uiStore.pendingFsEntryRename = { path: 'test.mp4' };
    await nextTick();

    expect(startRename).not.toHaveBeenCalled();
    // Does not clear state so the other panel can handle it
    expect(uiStore.pendingFsEntryRename).not.toBeNull();
  });

  it('handles remote download request and clears state', async () => {
    const handlePendingRemoteDownloadRequest = vi.fn().mockResolvedValue(undefined);
    useFileBrowserPendingActions({
      folderEntries: ref([]),
      startRename: vi.fn(),
      createTimelineInDirectory: vi.fn(),
      createMarkdownInDirectory: vi.fn(),
      handlePendingRemoteDownloadRequest,
    });

    uiStore.pendingRemoteDownloadRequest = { fileId: '123' };
    await nextTick(); // watch triggered
    await Promise.resolve(); // handler finished

    expect(handlePendingRemoteDownloadRequest).toHaveBeenCalledTimes(1);
    expect(uiStore.pendingRemoteDownloadRequest).toBeNull();
  });
});
