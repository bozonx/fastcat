// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
  env: {
    allowRemoteModels: false,
    allowLocalModels: true,
    useBrowserCache: false,
    localModelPath: '/models/',
    backends: { onnx: { gpu: false } },
  },
}));

vi.mock('~/utils/dev-logger', () => ({
  createDevLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('~/workers/core/io-governor', () => ({
  runResilientWorkerFileIo: vi.fn(async (_handle: unknown, fn: () => Promise<unknown>) => fn()),
}));

describe('stt.worker', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalOnMessage: typeof globalThis.onmessage;
  let postedMessages: unknown[];
  let messageHandlers: ((event: { data: unknown }) => void)[];

  beforeEach(() => {
    vi.resetModules();
    postedMessages = [];
    messageHandlers = [];
    originalFetch = globalThis.fetch;
    originalOnMessage = globalThis.onmessage;

    // Mock self.postMessage and self.onmessage
    (globalThis as any).postMessage = vi.fn((msg: unknown) => {
      postedMessages.push(msg);
    });
    (globalThis as any).onmessage = null;

    // Capture addEventListener for 'message'
    (globalThis as any).addEventListener = vi.fn((event: string, handler: (ev: unknown) => void) => {
      if (event === 'message') {
        messageHandlers.push(handler as (event: { data: unknown }) => void);
      }
    });

    // Mock navigator.gpu — navigator may be read-only in some environments
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        ...(globalThis as any).navigator,
        gpu: undefined,
      },
      writable: true,
      configurable: true,
    });

    // stt.worker uses `self` — alias it to globalThis
    (globalThis as any).self = globalThis;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as any).onmessage = originalOnMessage;
    vi.restoreAllMocks();
  });

  it('overrides self.fetch to intercept /models/ URLs', async () => {
    const mockResponse = new Response('test-data');
    const originalFetchMock = vi.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = originalFetchMock;

    // Set up modelDirHandle and currentModelName via init message
    const mockDirHandle = {
      getDirectoryHandle: vi.fn().mockResolvedValue({
        getDirectoryHandle: vi.fn().mockResolvedValue({
          getFileHandle: vi.fn().mockResolvedValue({
            getFile: vi.fn().mockResolvedValue(new File(['data'], 'model.onnx')),
          }),
        }),
      }),
    };

    await import('~/workers/stt.worker');

    // Send init message to set modelDirHandle
    const { pipeline } = await import('@huggingface/transformers');
    (pipeline as any).mockResolvedValue(vi.fn().mockResolvedValue({ chunks: [] }));

    // Trigger onmessage with init
    const initEvent = {
      data: {
        type: 'init',
        id: 1,
        data: { modelDirHandle: mockDirHandle },
      },
    };
    if (globalThis.onmessage) {
      (globalThis.onmessage as any)(initEvent);
    }

    // Wait for init
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Now send a transcribe message to set currentModelName
    const transcribeEvent = {
      data: {
        type: 'transcribe',
        id: 2,
        data: {
          audio: new Float32Array(16000),
          modelName: 'Xenova/whisper-tiny',
          language: 'en',
          subtask: 'transcribe',
        },
      },
    };
    if (globalThis.onmessage) {
      (globalThis.onmessage as any)(transcribeEvent);
    }

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    // The fetch override should be in place
    // Since modelDirHandle is set and currentModelName is set,
    // a fetch to /models/Xenova/whisper-tiny/file.onnx should be intercepted
    const interceptedFetch = globalThis.fetch;
    expect(interceptedFetch).not.toBe(originalFetchMock);
  });

  it('passes through non-model URLs to original fetch', async () => {
    const mockResponse = new Response('passthrough');
    const originalFetchMock = vi.fn().mockResolvedValue(mockResponse);
    globalThis.fetch = originalFetchMock;

    await import('~/workers/stt.worker');

    // Fetch a non-model URL
    const result = await fetch('https://example.com/api/data');

    expect(originalFetchMock).toHaveBeenCalledWith('https://example.com/api/data', undefined);
    expect(result).toBe(mockResponse);
  });

  it('responds with init-ok when init message is received', async () => {
    await import('~/workers/stt.worker');

    const mockDirHandle = { getDirectoryHandle: vi.fn() };
    const initEvent = {
      data: {
        type: 'init',
        id: 42,
        data: { modelDirHandle: mockDirHandle },
      },
    };

    if (globalThis.onmessage) {
      (globalThis.onmessage as any)(initEvent);
    }

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(postedMessages).toContainEqual({ type: 'init-ok', id: 42 });
  });

  it('posts error message when transcription fails', async () => {
    const { pipeline } = await import('@huggingface/transformers');
    (pipeline as any).mockRejectedValue(new Error('Model load failed'));

    await import('~/workers/stt.worker');

    const transcribeEvent = {
      data: {
        type: 'transcribe',
        id: 99,
        data: {
          audio: new Float32Array(16000),
          modelName: 'Xenova/whisper-tiny',
          language: 'en',
          subtask: 'transcribe',
        },
      },
    };

    if (globalThis.onmessage) {
      (globalThis.onmessage as any)(transcribeEvent);
    }

    // Wait for the promise chain to settle
    await new Promise((resolve) => setTimeout(resolve, 200));

    const errorMsg = postedMessages.find(
      (m) => (m as { type?: string }).type === 'error' && (m as { id?: number }).id === 99,
    );
    expect(errorMsg).toBeDefined();
    expect((errorMsg as { error: string }).error).toContain('Model load failed');
  });

  it('posts result message when transcription succeeds', async () => {
    const mockResult = { chunks: [{ text: 'hello' }] };
    // pipeline returns a callable function (the transcriber)
    const mockTranscriber = vi.fn().mockResolvedValue(mockResult);
    const { pipeline } = await import('@huggingface/transformers');
    (pipeline as any).mockResolvedValue(mockTranscriber);

    await import('~/workers/stt.worker');

    const transcribeEvent = {
      data: {
        type: 'transcribe',
        id: 77,
        data: {
          audio: new Float32Array(16000),
          modelName: 'Xenova/whisper-tiny',
          language: 'en',
          subtask: 'transcribe',
        },
      },
    };

    if (globalThis.onmessage) {
      (globalThis.onmessage as any)(transcribeEvent);
    }

    // Wait for the promise chain to settle
    await new Promise((resolve) => setTimeout(resolve, 200));

    const resultMsg = postedMessages.find(
      (m) => (m as { type?: string }).type === 'result' && (m as { id?: number }).id === 77,
    );
    expect(resultMsg).toBeDefined();
    expect((resultMsg as { data: unknown }).data).toEqual(mockResult);
  });

  it('returns 404 response when local model file is not found', async () => {
    const originalFetchMock = vi.fn().mockResolvedValue(new Response('ok'));
    globalThis.fetch = originalFetchMock;

    const mockDirHandle = {
      getDirectoryHandle: vi.fn().mockRejectedValue(new Error('Not found')),
    };

    await import('~/workers/stt.worker');

    // Init to set modelDirHandle
    const initEvent = {
      data: {
        type: 'init',
        id: 1,
        data: { modelDirHandle: mockDirHandle },
      },
    };
    if (globalThis.onmessage) {
      (globalThis.onmessage as any)(initEvent);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Transcribe to set currentModelName
    const { pipeline } = await import('@huggingface/transformers');
    (pipeline as any).mockResolvedValue(vi.fn().mockResolvedValue({ chunks: [] }));

    const transcribeEvent = {
      data: {
        type: 'transcribe',
        id: 2,
        data: {
          audio: new Float32Array(16000),
          modelName: 'Xenova/whisper-tiny',
          language: 'en',
          subtask: 'transcribe',
        },
      },
    };
    if (globalThis.onmessage) {
      (globalThis.onmessage as any)(transcribeEvent);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Now try to fetch a model file
    const response = await fetch('/models/Xenova/whisper-tiny/file.onnx');
    expect(response.status).toBe(404);
  });

  it('ignores messages with unknown type', async () => {
    await import('~/workers/stt.worker');

    const unknownEvent = {
      data: {
        type: 'unknown',
        id: 1,
        data: {},
      },
    };

    if (globalThis.onmessage) {
      (globalThis.onmessage as any)(unknownEvent);
    }

    await new Promise((resolve) => setTimeout(resolve, 10));

    // No messages should have been posted
    expect(postedMessages.length).toBe(0);
  });
});
