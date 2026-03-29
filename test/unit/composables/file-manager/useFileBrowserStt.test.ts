import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { useRuntimeConfig } from '#imports';
import { useFileBrowserTranscription } from '~/composables/file-manager/useFileBrowserTranscription';
import { transcribeAudioFile } from '~/utils/transcription/engine';
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

vi.mock('~/utils/transcription/engine', () => ({
  transcribeAudioFile: vi.fn(),
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

describe('useFileBrowserTranscription', () => {
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
    config.public.bloggerDogApiUrl = 'http://test-base.com';

    vi.mocked(getMediaTypeFromFilename).mockImplementation((name) => {
      if (name.endsWith('.mp3')) return 'audio';
      if (name.endsWith('.mp4')) return 'video';
      if (name.endsWith('.txt')) return 'text';
      return 'unknown';
    });
  });

  it('computes sttConfig correctly', () => {
    const { sttConfig } = useFileBrowserTranscription();
    expect(sttConfig.value).toEqual({ provider: 'test-provider', bearerToken: 'token' });
    expect(resolveExternalServiceConfig).toHaveBeenCalledWith({
      service: 'stt',
      integrations: workspaceStoreMock.userSettings.integrations,
      bloggerDogApiUrl: 'http://test-base.com',
    });
  });

  describe('isTranscribableMediaFile', () => {
    it('returns false if entry is not a file or is remote', () => {
      const { isTranscribableMediaFile } = useFileBrowserTranscription();
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
      const { isTranscribableMediaFile } = useFileBrowserTranscription();
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
      const { isTranscribableMediaFile } = useFileBrowserTranscription();
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
      const { isTranscribableMediaFile } = useFileBrowserTranscription();
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
        transcriptionModalOpen,
        transcriptionLanguage,
        transcriptionError,
        transcriptionEntry,
      } = useFileBrowserTranscription();

      transcriptionLanguage.value = 'en';
      transcriptionError.value = 'some error';

      const entry = { kind: 'file', name: 'test.mp3', path: '/test.mp3', source: 'local' } as any;
      openTranscriptionModal(entry);

      expect(transcriptionLanguage.value).toBe('');
      expect(transcriptionError.value).toBe('');
      expect(transcriptionModalOpen.value).toBe(true);
      expect(transcriptionEntry.value).toStrictEqual(entry);
    });
  });

  describe('submitTranscription', () => {
    it('does nothing if no entry or missing project requirements', async () => {
      const { submitTranscription, isTranscribing } = useFileBrowserTranscription();
      await submitTranscription();
      expect(isTranscribing.value).toBe(false);
      expect(transcribeAudioFile).not.toHaveBeenCalled();
    });

    it('sets error if file cannot be accessed', async () => {
      projectStoreMock.getFileByPath.mockResolvedValue(null);

      const {
        submitTranscription,
        openTranscriptionModal,
        transcriptionError,
        isTranscribing,
      } = useFileBrowserTranscription();
      openTranscriptionModal({
        kind: 'file',
        name: 'test.mp3',
        path: '/test.mp3',
        source: 'local',
      } as any);

      await submitTranscription();

      expect(transcriptionError.value).toBe('Failed to access file for transcription');
      expect(isTranscribing.value).toBe(false);
    });

    it('handles transcription failure', async () => {
      vi.mocked(transcribeAudioFile).mockRejectedValue(new Error('Network error'));

      const {
        submitTranscription,
        openTranscriptionModal,
        transcriptionError,
        isTranscribing,
        transcriptionLanguage,
      } = useFileBrowserTranscription();
      openTranscriptionModal({
        kind: 'file',
        name: 'test.mp3',
        path: '/test.mp3',
        source: 'local',
      } as any);
      transcriptionLanguage.value = 'en-US';

      await submitTranscription();

      expect(transcribeAudioFile).toHaveBeenCalledWith(
        expect.objectContaining({
          file: expect.any(File),
          filePath: '/test.mp3',
          fileName: 'test.mp3',
          fileType: 'audio/mp3',
          language: 'en-US',
          bloggerDogApiUrl: 'http://test-base.com',
          projectId: 'test-project-id',
          userSettings: workspaceStoreMock.userSettings,
          workspaceHandle: workspaceStoreMock.workspaceHandle,
          resolvedStorageTopology: workspaceStoreMock.resolvedStorageTopology,
        }),
      );

      expect(transcriptionError.value).toBe('Network error');
      expect(isTranscribing.value).toBe(false);
    });

    it('handles transcription success (uncached, audio)', async () => {
      vi.mocked(transcribeAudioFile).mockResolvedValue({ cached: false } as any);

      const {
        submitTranscription,
        openTranscriptionModal,
        transcriptionModalOpen,
        isTranscribing,
      } = useFileBrowserTranscription();
      openTranscriptionModal({
        kind: 'file',
        name: 'test.mp3',
        path: '/test.mp3',
        source: 'local',
      } as any);

      await submitTranscription();

      expect(transcriptionModalOpen.value).toBe(false);
      expect(isTranscribing.value).toBe(false);
      expect(mockToastAdd).toHaveBeenCalledWith({
        title: 'Transcription completed',
        description: 'Transcription was saved to vardata cache.',
        color: 'success',
      });
    });

    it('handles transcription success (cached, video)', async () => {
      vi.mocked(transcribeAudioFile).mockResolvedValue({ cached: true } as any);

      const { submitTranscription, openTranscriptionModal } = useFileBrowserTranscription();
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
      vi.mocked(transcribeAudioFile).mockResolvedValue({ cached: false } as any);

      const { submitTranscription, openTranscriptionModal } = useFileBrowserTranscription();
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
