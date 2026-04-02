/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

// Provide mocks for Nuxt auto-imports explicitly before importing the composable
vi.stubGlobal('useRuntimeConfig', vi.fn(() => ({
  public: { bloggerDogApiUrl: 'http://test-base.com' },
})));
vi.stubGlobal('useToast', vi.fn(() => ({ add: vi.fn() })));
vi.stubGlobal('useI18n', vi.fn(() => ({
  t: (key: string, fallback: string) => fallback,
})));

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

describe('useFileBrowserTranscription', () => {
  let workspaceStoreMock: any;
  let projectStoreMock: any;

  beforeEach(() => {
    setActivePinia(createPinia());
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

  it('submits transcription successfully', async () => {
    const { submitTranscription } = useFileBrowserTranscription();
    vi.mocked(transcribeAudioFile).mockResolvedValue({
      cacheKey: 'test-key',
      cached: false,
      record: {
        key: 'test-key',
        createdAt: '2022-01-01',
        sourcePath: 'test.mp3',
        sourceName: 'test.mp3',
        sourceSize: 100,
        sourceLastModified: 100,
        language: 'en',
        provider: 'test-provider',
        models: [],
        response: { text: 'transcribed text' },
      },
    });

    const result = await submitTranscription('test.mp3', 'en');
    expect(result).toEqual({ text: 'transcribed text' });
    expect(transcribeAudioFile).toHaveBeenCalled();
  });

  it('handles transcription failure', async () => {
    const { submitTranscription, transcriptionError } = useFileBrowserTranscription();
    vi.mocked(transcribeAudioFile).mockRejectedValue(new Error('Transcription error'));

    const result = await submitTranscription('test.mp3', 'en');
    expect(result).toBeNull();
    expect(transcriptionError.value).toBe('Transcription error');
  });
});
