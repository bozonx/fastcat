import { beforeEach, describe, expect, it, vi } from 'vitest';

const { transcribeProjectAudioFile } = vi.hoisted(() => ({
  transcribeProjectAudioFile: vi.fn(),
}));

const projectStore = {
  currentProjectId: 'project-1',
};

const workspaceStore = {
  workspaceHandle: { kind: 'directory' },
  resolvedStorageTopology: { mode: 'desktop' },
  userSettings: { integrations: {} },
};

vi.mock('~/stores/project.store', () => ({
  useProjectStore: () => projectStore,
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => workspaceStore,
}));

vi.mock('~/utils/media-types', () => ({
  getMediaTypeFromFilename: vi.fn((name: string) => (name.endsWith('.mp4') ? 'video' : 'audio')),
  getMimeTypeFromFilename: vi.fn(() => 'video/mp4'),
}));

vi.mock('~/utils/external-integrations', () => ({
  resolveExternalServiceConfig: vi.fn(() => ({ provider: 'stub' })),
}));

vi.mock('~/utils/stt', () => ({
  transcribeProjectAudioFile,
}));

import { useFileManagerPanelStt } from '../../../../src/composables/fileManager/useFileManagerPanelStt';
import type { FsEntry } from '../../../../src/types/fs';

describe('useFileManagerPanelStt', () => {
  beforeEach(() => {
    projectStore.currentProjectId = 'project-1';
    workspaceStore.workspaceHandle = { kind: 'directory' } as any;
    transcribeProjectAudioFile.mockReset();
  });

  it('recognizes supported media files when STT dependencies are available', () => {
    const stt = useFileManagerPanelStt({
      vfs: { getFile: vi.fn() },
      fastcatPublicadorBaseUrl: 'https://example.test',
      onSuccess: vi.fn(),
      onError: vi.fn(),
    });

    const entry: FsEntry = {
      kind: 'file',
      name: 'clip.mp4',
      path: 'clips/clip.mp4',
      source: 'local' as any,
    };

    expect(stt.isTranscribableMediaFile(entry)).toBe(true);
  });

  it('submits transcription and reports success', async () => {
    const file = new File(['demo'], 'clip.mp4', { type: 'video/mp4' });
    transcribeProjectAudioFile.mockResolvedValue({ cached: true });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const stt = useFileManagerPanelStt({
      vfs: { getFile: vi.fn().mockResolvedValue(file) },
      fastcatPublicadorBaseUrl: 'https://example.test',
      onSuccess,
      onError,
    });

    stt.openModal({
      kind: 'file',
      name: 'clip.mp4',
      path: 'clips/clip.mp4',
      source: 'local' as any,
    });
    stt.language.value = 'en';

    await stt.submitTranscription();

    expect(transcribeProjectAudioFile).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledWith({ cached: true, mediaType: 'video' });
    expect(onError).not.toHaveBeenCalled();
    expect(stt.modalOpen.value).toBe(false);
    expect(stt.isTranscribing.value).toBe(false);
  });
});
