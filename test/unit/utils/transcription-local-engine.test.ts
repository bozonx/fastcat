/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockTranscribeLocally = vi.fn();
const mockIsModelDownloaded = vi.fn();
const mockGetSttModelsDir = vi.fn();

vi.mock('~/workers/stt.worker.ts?worker', () => {
  return {
    default: class MockWorker {
      postMessage = vi.fn();
      terminate = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      onmessage = null;
      onerror = null;
    };
  };
});

vi.mock('~/workers/audio-decode.worker.ts?worker', () => {
  return {
    default: class MockAudioDecodeWorker {
      postMessage = vi.fn();
      terminate = vi.fn();
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
    },
  };
});

vi.mock('~/utils/transcription/model-storage', () => ({
  getSttModelsDir: mockGetSttModelsDir,
  isModelDownloaded: mockIsModelDownloaded,
}));

vi.mock('~/repositories/transcription-cache.repository', () => ({
  createTranscriptionCacheRepository: () => ({
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
  }),
}));

describe('transcription local-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isModelDownloaded', () => {
    it('returns true when all required files exist', async () => {
      const { isModelDownloaded } = await import('~/utils/transcription/model-storage');
      
      const mockDirHandle = {
        getDirectoryHandle: vi.fn().mockResolvedValue({
          getDirectoryHandle: vi.fn().mockResolvedValue({
            getFileHandle: vi.fn().mockResolvedValue({}),
          }),
          getFileHandle: vi.fn().mockResolvedValue({}),
        }),
      };

      const result = await isModelDownloaded(
        mockDirHandle as any,
        'Xenova/whisper-tiny',
      );

      expect(result).toBe(true);
    });

    it('returns false when model name is unknown', async () => {
      const { isModelDownloaded } = await import('~/utils/transcription/model-storage');
      
      const mockDirHandle = {} as FileSystemDirectoryHandle;

      const result = await isModelDownloaded(mockDirHandle, 'unknown-model');

      expect(result).toBe(false);
    });
  });

  describe('getSttModelsDir', () => {
    it('creates directory structure', async () => {
      const { getSttModelsDir } = await import('~/utils/transcription/model-storage');
      
      const mockModelsDir = {};
      const mockVardata = {
        getDirectoryHandle: vi.fn().mockResolvedValue(mockModelsDir),
      };
      const mockWorkspace = {
        getDirectoryHandle: vi.fn().mockResolvedValue(mockVardata),
      };

      await getSttModelsDir(mockWorkspace as any);

      expect(mockWorkspace.getDirectoryHandle).toHaveBeenCalledWith('vardata', { create: true });
      expect(mockVardata.getDirectoryHandle).toHaveBeenCalledWith('models', { create: true });
    });
  });
});