/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { transcribeAudioFile } from '~/utils/transcription/engine';

const hostRpc = vi.hoisted(() => ({
  available: false,
  call: vi.fn(),
}));

vi.mock('~/utils/embed/host-rpc', () => ({
  isHostRpcAvailable: () => hostRpc.available,
  callHostRpc: hostRpc.call,
}));

vi.mock('~/utils/external-integrations', () => ({
  resolveExternalServiceConfig: () => ({
    bearerToken: 'token',
  }),
  resolveSttStreamUrl: () => 'https://stt.example.test/transcribe',
}));

describe('transcribeAudioFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostRpc.available = false;
  });

  it('builds remote STT headers without throwing', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ text: 'hello' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await transcribeAudioFile({
      file: new File(['audio'], 'voice.wav', { type: 'audio/wav' }),
      filePath: '/voice.wav',
      fileName: 'voice.wav',
      fileType: 'audio/wav',
      language: 'en',
      fastcatAccountApiUrl: '',
      workspaceHandle: null,
      userSettings: {
        integrations: {
          stt: {
            provider: 'assemblyai',
            models: ['universal-2'],
            localModel: 'Xenova/whisper-tiny',
            language: 'en',
            restorePunctuation: true,
            formatText: true,
            includeWords: true,
          },
        },
      } as any,
    });

    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('X-STT-Max-Wait-Minutes')).toBe('0');
    expect(headers.get('Authorization')).toBe('Bearer token');

    vi.unstubAllGlobals();
  });

  it('delegates remote STT to the embedding host when RPC is available', async () => {
    hostRpc.available = true;
    hostRpc.call.mockResolvedValue({ record: { response: { text: 'from host' } } });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await transcribeAudioFile({
      file: new File(['audio'], 'voice.wav', { type: 'audio/wav' }),
      filePath: '/voice.wav',
      fileName: 'voice.wav',
      fileType: 'audio/wav',
      language: 'en',
      fastcatAccountApiUrl: '',
      workspaceHandle: null,
      userSettings: {
        integrations: {
          stt: {
            provider: 'assemblyai',
            models: ['universal-2'],
            localModel: 'Xenova/whisper-tiny',
            language: 'en',
            restorePunctuation: true,
            formatText: true,
            includeWords: true,
          },
        },
      } as any,
    });

    expect(result.record.response).toEqual({ text: 'from host' });
    expect(hostRpc.call).toHaveBeenCalledWith(
      'stt',
      expect.objectContaining({ fileName: 'voice.wav', contentType: 'audio/wav' }),
      { signal: undefined },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
