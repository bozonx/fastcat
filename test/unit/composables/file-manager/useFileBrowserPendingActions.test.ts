import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref, reactive, effectScope, type EffectScope } from 'vue';

import { useFileBrowserPendingActions } from '~/composables/fileManager/useFileBrowserPendingActions';

const uiStore = reactive({
  pendingFsEntryRename: null as any,
  pendingFsEntryCreateTimeline: null as any,
  pendingFsEntryCreateMarkdown: null as any,
  pendingRemoteDownloadRequest: null as any,
});

vi.mock('~/stores/ui.store', () => ({ useUiStore: () => uiStore }));

describe('useFileBrowserPendingActions', () => {
  let scope: EffectScope;

  beforeEach(() => {
    uiStore.pendingFsEntryRename = null;
    uiStore.pendingFsEntryCreateTimeline = null;
    uiStore.pendingFsEntryCreateMarkdown = null;
    uiStore.pendingRemoteDownloadRequest = null;
    vi.clearAllMocks();
    scope = effectScope();
  });

  afterEach(() => {
    scope.stop();
  });

  it('triggers rename if entry is in current folder and clears state', async () => {
    const startRename = vi.fn();
    const folderEntries = ref([{ path: 'test.mp4' }]);

    scope.run(() => {
      useFileBrowserPendingActions({
        folderEntries: folderEntries as any,
        startRename,
        createTimelineInDirectory: vi.fn(),
        createMarkdownInDirectory: vi.fn(),
        handlePendingRemoteDownloadRequest: vi.fn(),
      });
    });

    uiStore.pendingFsEntryRename = { path: 'test.mp4' };
    await nextTick();

    expect(startRename).toHaveBeenCalledWith({ path: 'test.mp4' });
    expect(uiStore.pendingFsEntryRename).toBeNull();
  });

  it('ignores rename if entry is not in current folder', async () => {
    const startRename = vi.fn();
    const folderEntries = ref([{ path: 'other.mp4' }]);

    scope.run(() => {
      useFileBrowserPendingActions({
        folderEntries: folderEntries as any,
        startRename,
        createTimelineInDirectory: vi.fn(),
        createMarkdownInDirectory: vi.fn(),
        handlePendingRemoteDownloadRequest: vi.fn(),
      });
    });

    uiStore.pendingFsEntryRename = { path: 'test.mp4' };
    await nextTick();

    expect(startRename).not.toHaveBeenCalled();
    // Does not clear state so the other panel can handle it
    expect(uiStore.pendingFsEntryRename).not.toBeNull();
  });

  it('handles remote download request and clears state', async () => {
    const handlePendingRemoteDownloadRequest = vi.fn().mockResolvedValue(undefined);
    scope.run(() => {
      useFileBrowserPendingActions({
        folderEntries: ref([]),
        startRename: vi.fn(),
        createTimelineInDirectory: vi.fn(),
        createMarkdownInDirectory: vi.fn(),
        handlePendingRemoteDownloadRequest,
      });
    });

    uiStore.pendingRemoteDownloadRequest = { fileId: '123' };
    await nextTick(); // watch triggered
    await Promise.resolve(); // handler finished

    expect(handlePendingRemoteDownloadRequest).toHaveBeenCalledTimes(1);
    expect(uiStore.pendingRemoteDownloadRequest).toBeNull();
  });
});
