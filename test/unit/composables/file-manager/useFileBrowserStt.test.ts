/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('#app/nuxt', () => ({
  useRuntimeConfig: vi.fn(() => ({ public: { bloggerDogApiUrl: 'http://test-base.com' } })),
  useNuxtApp: vi.fn(() => ({})),
  useToast: vi.fn(() => ({ add: vi.fn() })),
  useI18n: vi.fn(() => ({ t: (k: string, f?: string) => f || k })),
}));

// Also mock #imports for good measure
vi.mock('#imports', () => ({
  useRuntimeConfig: vi.fn(() => ({ public: { bloggerDogApiUrl: 'http://test-base.com' } })),
  useToast: vi.fn(() => ({ add: vi.fn() })),
  useI18n: vi.fn(() => ({ t: (k: string, f?: string) => f || k })),
  useNuxtApp: vi.fn(() => ({})),
}));

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
      return 'unknown';
    });
  });

  it('computes sttConfig correctly', () => {
    const { sttConfig } = useFileBrowserTranscription();
    expect(sttConfig.value).toEqual({ provider: 'test-provider', bearerToken: 'token' });
  });

  it('submits transcription successfully', async () => {
    const { submitTranscription, transcriptionEntry, transcriptionLanguage, transcriptionModalOpen } = useFileBrowserTranscription();
    
    // Set up state
    transcriptionEntry.value = { name: 'test.mp3', path: 'path/to/test.mp3', kind: 'file' } as any;
    transcriptionLanguage.value = 'en';
    transcriptionModalOpen.value = true;

    vi.mocked(transcribeAudioFile).mockResolvedValue({
      cacheKey: 'test-key',
      cached: false,
      record: {
        key: 'test-key',
        createdAt: '2022-01-01',
        sourcePath: 'path/to/test.mp3',
        sourceName: 'test.mp3',
        sourceSize: 0,
        sourceLastModified: 0,
        language: 'en',
        provider: 'test-provider',
        models: [],
        response: { text: 'transcribed text' },
      },
    });

    await submitTranscription();
    
    expect(transcriptionModalOpen.value).toBe(false);
    expect(transcribeAudioFile).toHaveBeenCalled();
  });
});
