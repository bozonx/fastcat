/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';

// Mock dependencies of local-engine
const mockGetSttModelsDir = vi.fn();
const mockIsModelDownloaded = vi.fn();

vi.mock('~/utils/transcription/model-storage', () => ({
  getSttModelsDir: mockGetSttModelsDir,
  isModelDownloaded: mockIsModelDownloaded,
}));

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
    addEventListener = vi.fn();
    removeEventListener = vi.fn();
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: ErrorEvent) => void) | null = null;
  },
}));

describe('transcription local-engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsModelDownloaded.mockResolvedValue(true);
    mockGetSttModelsDir.mockResolvedValue({} as any);
  });

  it('fails if model is not downloaded', async () => {
    const { transcribeLocally } = await import('~/utils/transcription/local-engine');
    mockIsModelDownloaded.mockResolvedValue(false);

    const request: any = {
      file: new File([], 'test.mp3'),
      workspaceHandle: {},
      userSettings: { integrations: { stt: { localModel: 'test' } } },
    };

    await expect(transcribeLocally(request)).rejects.toThrow(/not downloaded/);
  });

  it('can be imported and functions exist', async () => {
    const module = await import('~/utils/transcription/local-engine');
    expect(module.transcribeLocally).toBeDefined();
  });
});