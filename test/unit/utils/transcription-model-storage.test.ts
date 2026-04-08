/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('~/workers/stt.worker.ts?worker', () => ({
  default: class MockWorker {
    postMessage = vi.fn();
    terminate = vi.fn();
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
  },
}));

vi.mock('~/workers/audio-decode.worker.ts?worker', () => ({
  default: class MockAudioDecodeWorker {
    postMessage = vi.fn();
    terminate = vi.fn();
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
  },
}));

vi.mock('~/repositories/transcription-cache.repository', () => ({
  createTranscriptionCacheRepository: () => ({
    save: vi.fn().mockResolvedValue(undefined),
    load: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
  }),
}));

describe('transcription model-storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('WHISPER_MODEL_FILES', () => {
    it('contains required models', async () => {
      const { WHISPER_MODEL_FILES } = await import('~/utils/transcription/model-storage');

      expect(WHISPER_MODEL_FILES['Xenova/whisper-tiny']).toBeDefined();
      expect(WHISPER_MODEL_FILES['Xenova/whisper-base']).toBeDefined();
      expect(WHISPER_MODEL_FILES['Xenova/whisper-small']).toBeDefined();
      expect(WHISPER_MODEL_FILES['onnx-community/whisper-tiny']).toBeDefined();
    });

    it('includes essential ONNX files for each model', async () => {
      const { WHISPER_MODEL_FILES } = await import('~/utils/transcription/model-storage');

      const tinyFiles = WHISPER_MODEL_FILES['Xenova/whisper-tiny'];
      expect(tinyFiles).toContain('config.json');
      expect(tinyFiles).toContain('tokenizer.json');
      expect(tinyFiles!.find((f) => f.includes('encoder'))).toBeDefined();
      expect(tinyFiles!.find((f) => f.includes('decoder'))).toBeDefined();
    });
  });

  describe('isModelDownloaded', () => {
    it('returns false when model name is unknown', async () => {
      const { isModelDownloaded } = await import('~/utils/transcription/model-storage');

      const mockDirHandle = {} as FileSystemDirectoryHandle;
      const result = await isModelDownloaded(mockDirHandle, 'unknown-model');

      expect(result).toBe(false);
    });
  });

  describe('getSttModelsDir', () => {
    it('creates directory structure with create: true', async () => {
      const { getSttModelsDir } = await import('~/utils/transcription/model-storage');

      const mockSttDir = { name: 'stt' };
      const mockModelsDir = {
        name: 'models',
        getDirectoryHandle: vi.fn().mockResolvedValue(mockSttDir),
      };
      const mockVardata = {
        name: 'vardata',
        getDirectoryHandle: vi.fn().mockResolvedValue(mockModelsDir),
      };

      const mockWorkspace = {
        getDirectoryHandle: vi.fn().mockResolvedValue(mockVardata),
      };

      const result = await getSttModelsDir(mockWorkspace as any);

      expect(mockWorkspace.getDirectoryHandle).toHaveBeenCalledWith('vardata', { create: true });
      expect(mockVardata.getDirectoryHandle).toHaveBeenCalledWith('models', { create: true });
      expect(mockModelsDir.getDirectoryHandle).toHaveBeenCalledWith('stt', { create: true });
      expect(result).toBe(mockSttDir);
    });
  });
});
