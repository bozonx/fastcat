import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { useRuntimeConfig } from '#imports';
import { useFileBrowserStt } from '~/composables/fileManager/useFileBrowserStt';
import { transcribeProjectAudioFile } from '~/utils/stt';
import { resolveExternalServiceConfig } from '~/utils/external-integrations';
import { getMediaTypeFromFilename } from '~/utils/media-types';
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectStore } from '~/stores/project.store';

// Mock dependencies
vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(),
}));

vi.mock('~/utils/external-integrations', () => ({
  resolveExternalServiceConfig: vi.fn(),
}));

vi.mock('~/utils/stt', () => ({
  transcribeProjectAudioFile: vi.fn(),
}));

vi.mock('~/utils/media-types', () => ({
  getMediaTypeFromFilename: vi.fn(),
}));

const { mockToastAdd } = vi.hoisted(() => ({
  mockToastAdd: vi.fn(),
}));

mockNuxtImport('useToast', () => {
  return () => ({ add: mockToastAdd });
});

mockNuxtImport('useI18n', () => {
  return () => ({
    t: (key: string, fallback: string) => fallback,
  });
});

describe('useFileBrowserStt', () => {
  let workspaceStoreMock: any;
  let projectStoreMock: any;

  beforeEach(() => {
    vi.clearAllMocks();

    workspaceStoreMock = {
      userSettings: { integrations: { stt: {} } },
      workspaceHandle: {}, // Mock handle
      resolvedStorageTopology: {},
    };
    vi.mocked(useWorkspaceStore).mockReturnValue(workspaceStoreMock);

    projectStoreMock = {
      currentProjectId: 'test-project-id',
      getFileByPath: vi.fn().mockResolvedValue(new File([''], 'test.mp3', { type: 'audio/mp3' })),
    };
    vi.mocked(useProjectStore).mockReturnValue(projectStoreMock);

    vi.mocked(resolveExternalServiceConfig).mockReturnValue({
      provider: 'test-provider',
      bearerToken: 'token',
    } as any);

    const config = useRuntimeConfig();
    config.public.fastcatPublicadorBaseUrl = 'http://test-base.com';

    vi.mocked(getMediaTypeFromFilename).mockImplementation((name) => {
      if (name.endsWith('.mp3')) return 'audio';
      if (name.endsWith('.mp4')) return 'video';
      if (name.endsWith('.txt')) return 'text';
      return 'unknown';
    });
  });

  it('computes sttConfig correctly', () => {
    const { sttConfig } = useFileBrowserStt();
    expect(sttConfig.value).toEqual({ provider: 'test-provider', bearerToken: 'token' });
    expect(resolveExternalServiceConfig).toHaveBeenCalledWith({
      service: 'stt',
      integrations: workspaceStoreMock.userSettings.integrations,
      fastcatPublicadorBaseUrl: 'http://test-base.com',
    });
  });

  describe('isTranscribableMediaFile', () => {
    it('returns false if entry is not a file or is remote', () => {
      const { isTranscribableMediaFile } = useFileBrowserStt();
      expect(
        isTranscribableMediaFile({
          kind: 'directory',
          name: 'dir',
          path: '/dir',
          source: 'local',
        } as any),
      ).toBe(false);
      expect(
        isTranscribableMediaFile({
          kind: 'file',
          name: 'file.mp3',
          path: '/file.mp3',
          source: 'remote',
        } as any),
      ).toBe(false);
    });

    it('returns false if media type is not audio or video', () => {
      const { isTranscribableMediaFile } = useFileBrowserStt();
      expect(
        isTranscribableMediaFile({
          kind: 'file',
          name: 'file.txt',
          path: '/file.txt',
          source: 'local',
        } as any),
      ).toBe(false);
    });

    it('returns false if config, workspaceHandle, or projectId is missing', () => {
      const { isTranscribableMediaFile } = useFileBrowserStt();
      const validEntry = { kind: 'file', name: 'file.mp3', path: '/file.mp3', source: 'local' };

      vi.mocked(resolveExternalServiceConfig).mockReturnValue(null);
      expect(isTranscribableMediaFile(validEntry as any)).toBe(false);
      vi.mocked(resolveExternalServiceConfig).mockReturnValue({ provider: 'test' } as any);

      workspaceStoreMock.workspaceHandle = null;
      expect(isTranscribableMediaFile(validEntry as any)).toBe(false);
      workspaceStoreMock.workspaceHandle = {};

      projectStoreMock.currentProjectId = null;
      expect(isTranscribableMediaFile(validEntry as any)).toBe(false);
    });

    it('returns true for valid audio/video local files when setup is complete', () => {
      const { isTranscribableMediaFile } = useFileBrowserStt();
      expect(
        isTranscribableMediaFile({
          kind: 'file',
          name: 'file.mp3',
          path: '/file.mp3',
          source: 'local',
        } as any),
      ).toBe(true);
      expect(
        isTranscribableMediaFile({
          kind: 'file',
          name: 'file.mp4',
          path: '/file.mp4',
          source: 'local',
        } as any),
      ).toBe(true);
    });
  });

  describe('openTranscriptionModal', () => {
    it('resets state and opens modal', () => {
      const {
        openTranscriptionModal,
        sttTranscriptionModalOpen,
        sttTranscriptionLanguage,
        sttTranscriptionError,
        sttTranscriptionEntry,
      } = useFileBrowserStt();

      sttTranscriptionLanguage.value = 'en';
      sttTranscriptionError.value = 'some error';

      const entry = { kind: 'file', name: 'test.mp3', path: '/test.mp3', source: 'local' } as any;
      openTranscriptionModal(entry);

      expect(sttTranscriptionLanguage.value).toBe('');
      expect(sttTranscriptionError.value).toBe('');
      expect(sttTranscriptionModalOpen.value).toBe(true);
      expect(sttTranscriptionEntry.value).toStrictEqual(entry);
    });
  });

  describe('submitTranscription', () => {
    it('does nothing if no entry or missing project requirements', async () => {
      const { submitTranscription, sttTranscribing } = useFileBrowserStt();
      await submitTranscription();
      expect(sttTranscribing.value).toBe(false);
      expect(transcribeProjectAudioFile).not.toHaveBeenCalled();
    });

    it('sets error if file cannot be accessed', async () => {
      projectStoreMock.getFileByPath.mockResolvedValue(null);

      const {
        submitTranscription,
        openTranscriptionModal,
        sttTranscriptionError,
        sttTranscribing,
      } = useFileBrowserStt();
      openTranscriptionModal({
        kind: 'file',
        name: 'test.mp3',
        path: '/test.mp3',
        source: 'local',
      } as any);

      await submitTranscription();

      expect(sttTranscriptionError.value).toBe('Failed to access file for transcription');
      expect(sttTranscribing.value).toBe(false);
    });

    it('handles transcription failure', async () => {
      vi.mocked(transcribeProjectAudioFile).mockRejectedValue(new Error('Network error'));

      const {
        submitTranscription,
        openTranscriptionModal,
        sttTranscriptionError,
        sttTranscribing,
        sttTranscriptionLanguage,
      } = useFileBrowserStt();
      openTranscriptionModal({
        kind: 'file',
        name: 'test.mp3',
        path: '/test.mp3',
        source: 'local',
      } as any);
      sttTranscriptionLanguage.value = 'en-US';

      await submitTranscription();

      expect(transcribeProjectAudioFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file: expect.any(File),
          filePath: '/test.mp3',
          fileName: 'test.mp3',
          fileType: 'audio/mp3',
          language: 'en-US',
          fastcatPublicadorBaseUrl: 'http://test-base.com',
          projectId: 'test-project-id',
          userSettings: workspaceStoreMock.userSettings,
          workspaceHandle: workspaceStoreMock.workspaceHandle,
          resolvedStorageTopology: workspaceStoreMock.resolvedStorageTopology,
        }),
      );

      expect(sttTranscriptionError.value).toBe('Network error');
      expect(sttTranscribing.value).toBe(false);
    });

    it('handles transcription success (uncached, audio)', async () => {
      vi.mocked(transcribeProjectAudioFile).mockResolvedValue({ cached: false } as any);

      const {
        submitTranscription,
        openTranscriptionModal,
        sttTranscriptionModalOpen,
        sttTranscribing,
      } = useFileBrowserStt();
      openTranscriptionModal({
        kind: 'file',
        name: 'test.mp3',
        path: '/test.mp3',
        source: 'local',
      } as any);

      await submitTranscription();

      expect(sttTranscriptionModalOpen.value).toBe(false);
      expect(sttTranscribing.value).toBe(false);
      expect(mockToastAdd).toHaveBeenCalledWith({
        title: 'Transcription completed',
        description: 'Transcription was saved to vardata cache.',
        color: 'success',
      });
    });

    it('handles transcription success (cached, video)', async () => {
      vi.mocked(transcribeProjectAudioFile).mockResolvedValue({ cached: true } as any);

      const { submitTranscription, openTranscriptionModal } = useFileBrowserStt();
      openTranscriptionModal({
        kind: 'file',
        name: 'test.mp4',
        path: '/test.mp4',
        source: 'local',
      } as any);

      await submitTranscription();

      expect(mockToastAdd).toHaveBeenCalledWith({
        title: 'Using cached transcription',
        description: 'Cached transcription was loaded from vardata.',
        color: 'success',
      });
    });

    it('handles transcription success (uncached, video)', async () => {
      vi.mocked(transcribeProjectAudioFile).mockResolvedValue({ cached: false } as any);

      const { submitTranscription, openTranscriptionModal } = useFileBrowserStt();
      openTranscriptionModal({
        kind: 'file',
        name: 'test.mp4',
        path: '/test.mp4',
        source: 'local',
      } as any);

      await submitTranscription();

      expect(mockToastAdd).toHaveBeenCalledWith({
        title: 'Transcription completed',
        description: 'Video audio track was transcribed and saved to vardata cache.',
        color: 'success',
      });
    });
  });
});
