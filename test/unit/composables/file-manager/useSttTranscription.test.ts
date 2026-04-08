/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSttTranscription } from '~/composables/file-manager/useSttTranscription';
import type { FsEntry } from '~/types/fs';

vi.mock('#app/nuxt', () => ({
  useRuntimeConfig: vi.fn(() => ({ public: { fastcatAccountApiUrl: 'http://test.api' } })),
  useNuxtApp: vi.fn(() => ({})),
  useToast: vi.fn(() => ({ add: vi.fn() })),
  useI18n: vi.fn(() => ({ t: (k: string, f?: string) => f || k })),
}));

vi.mock('#imports', () => ({
  useRuntimeConfig: vi.fn(() => ({ public: { fastcatAccountApiUrl: 'http://test.api' } })),
  useToast: vi.fn(() => ({ add: vi.fn() })),
  useI18n: vi.fn(() => ({ t: (k: string, f?: string) => f || k })),
  useNuxtApp: vi.fn(() => ({})),
}));

vi.mock('~/stores/project.store', () => ({
  useProjectStore: vi.fn(() => ({
    currentProjectId: 'test-project-id',
    currentProjectName: 'test-project',
    getFileByPath: vi.fn().mockResolvedValue(new File([''], 'test.mp3', { type: 'audio/mp3' })),
  })),
}));

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(() => ({
    workspaceHandle: {},
    userSettings: { integrations: { stt: { provider: 'local' } } },
    isSttModelDownloaded: true,
  })),
}));

vi.mock('~/utils/media-types', () => ({
  getMediaTypeFromFilename: vi.fn((name: string) => {
    if (name.endsWith('.mp3')) return 'audio';
    if (name.endsWith('.mp4')) return 'video';
    return 'unknown';
  }),
  getMimeTypeFromFilename: vi.fn(() => 'audio/mp3'),
}));

vi.mock('~/utils/external-integrations', () => ({
  resolveExternalServiceConfig: vi.fn(() => ({ provider: 'test-provider', bearerToken: 'token' })),
}));

vi.mock('~/utils/transcription/task-wrapper', () => ({
  runTranscriptionTask: vi.fn().mockResolvedValue({
    cached: false,
    cacheKey: 'test-key',
    record: {
      key: 'test-key',
      createdAt: '2024-01-01T00:00:00Z',
      sourcePath: 'test/test.mp3',
      sourceName: 'test.mp3',
      sourceSize: 1000,
      sourceLastModified: Date.now(),
      language: 'en',
      provider: 'local',
      models: ['Xenova/whisper-tiny'],
      response: { chunks: [] },
    },
  }),
}));

describe('useSttTranscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes sttConfig correctly', () => {
    const { sttConfig } = useSttTranscription({
      fastcatAccountApiUrl: 'http://test.api',
    });

    expect(sttConfig.value).toEqual({ provider: 'test-provider', bearerToken: 'token' });
  });

  it('recognizes transcribable media files', () => {
    const { isTranscribableMediaFile } = useSttTranscription({
      fastcatAccountApiUrl: 'http://test.api',
    });

    const audioFile: FsEntry = {
      kind: 'file',
      name: 'audio.mp3',
      path: 'audio.mp3',
      source: 'local',
    };

    const videoFile: FsEntry = {
      kind: 'file',
      name: 'video.mp4',
      path: 'video.mp4',
      source: 'local',
    };

    const textFile: FsEntry = {
      kind: 'file',
      name: 'document.txt',
      path: 'document.txt',
      source: 'local',
    };

    expect(isTranscribableMediaFile(audioFile)).toBe(true);
    expect(isTranscribableMediaFile(videoFile)).toBe(true);
    expect(isTranscribableMediaFile(textFile)).toBe(false);
  });

  it('opens and closes modal correctly', () => {
    const { modalOpen, openModal, closeModal } = useSttTranscription({
      fastcatAccountApiUrl: 'http://test.api',
    });

    const entry: FsEntry = {
      kind: 'file',
      name: 'test.mp3',
      path: 'test.mp3',
      source: 'local',
    };

    expect(modalOpen.value).toBe(false);
    openModal(entry);
    expect(modalOpen.value).toBe(true);
    closeModal();
    expect(modalOpen.value).toBe(false);
  });

  it('sets pending entry when opening modal', () => {
    const { pendingEntry, openModal } = useSttTranscription({
      fastcatAccountApiUrl: 'http://test.api',
    });

    const entry: FsEntry = {
      kind: 'file',
      name: 'test.mp3',
      path: 'test.mp3',
      source: 'local',
    };

    openModal(entry);
    expect(pendingEntry.value).toEqual(entry);
  });

  it('resets language and error when opening modal', () => {
    const { language, errorMessage, openModal } = useSttTranscription({
      fastcatAccountApiUrl: 'http://test.api',
    });

    language.value = 'en';
    errorMessage.value = 'Previous error';

    const entry: FsEntry = {
      kind: 'file',
      name: 'test.mp3',
      path: 'test.mp3',
      source: 'local',
    };

    openModal(entry);
    expect(language.value).toBe('');
    expect(errorMessage.value).toBe('');
  });
});
