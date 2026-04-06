import type {
  TranscriptionRequest,
  TranscriptionResult,
  LocalTranscriptionProgress,
  SttWorkerMessage,
  SttWorkerResponse,
} from './types';
import { createCacheKey } from './engine';
import { getSttModelsDir, isModelDownloaded } from './model-storage';
import { createTranscriptionCacheRepository } from '~/repositories/transcription-cache.repository';
import type { DecodeRequest, DecodeResponse } from '~/utils/audio/types';
import SttWorker from '~/workers/stt.worker.ts?worker';

export type { LocalTranscriptionProgress };

let currentRequestId = 0;

async function decodeAudioForStt(file: File, signal?: AbortSignal): Promise<Float32Array> {
  const decodeWorker = new (await import('~/workers/audio-decode.worker.ts?worker')).default();

  return new Promise((resolve, reject) => {
    const id = Math.random();

    const abortHandler = () => {
      decodeWorker.terminate();
      reject(new Error('Transcription cancelled'));
    };

    if (signal?.aborted) {
      decodeWorker.terminate();
      reject(new Error('Transcription cancelled'));
      return;
    }

    signal?.addEventListener('abort', abortHandler);

    decodeWorker.onmessage = (e: MessageEvent<DecodeResponse>) => {
      if (e.data.id !== id) return;

      signal?.removeEventListener('abort', abortHandler);
      decodeWorker.terminate();

      if (e.data.ok && e.data.result?.sttAudio) {
        resolve(e.data.result.sttAudio);
      } else {
        const errMsg = e.data.error?.message || 'Audio decoding failed';
        reject(new Error(errMsg));
      }
    };

    decodeWorker.onerror = (err) => {
      signal?.removeEventListener('abort', abortHandler);
      decodeWorker.terminate();
      reject(new Error(err.message || 'Audio decoding failed'));
    };

    const request: DecodeRequest = {
      type: 'decode-stt',
      id,
      sourceKey: 'stt-decode',
      blob: file,
      options: { targetSampleRate: 16000 },
    };

    decodeWorker.postMessage(request);
  });
}

export async function transcribeLocally(
  input: TranscriptionRequest,
  onProgress?: (p: LocalTranscriptionProgress) => void,
): Promise<TranscriptionResult> {
  const modelName = input.userSettings.integrations.stt.localModel || 'onnx-community/whisper-tiny';

  const modelsDir = await getSttModelsDir(input.workspaceHandle);
  const downloaded = await isModelDownloaded(input.workspaceHandle, modelName);
  if (!downloaded) {
    throw new Error(`Model ${modelName} is not downloaded. Please go to settings to download it.`);
  }

  onProgress?.({ status: 'decoding' });

  const file = input.file instanceof File ? input.file : await input.file.getFile();

  const finalAudio = await decodeAudioForStt(file, input.signal);

  const worker = new SttWorker();
  const id = ++currentRequestId;
  const signal = input.signal;

  onProgress?.({ status: 'initializing' });

  return new Promise((resolve, reject) => {
    let terminated = false;

    const cleanup = () => {
      if (terminated) return;
      terminated = true;
      worker.removeEventListener('message', handler);
      worker.terminate();
    };

    const abortHandler = () => {
      cleanup();
      reject(new Error('Transcription cancelled'));
    };

    if (signal?.aborted) {
      cleanup();
      reject(new Error('Transcription cancelled'));
      return;
    }

    signal?.addEventListener('abort', abortHandler);

    const handler = (event: MessageEvent<SttWorkerResponse>) => {
      if (terminated) return;
      const { type, id: msgId, data, error } = event.data as any;
      if (msgId !== id) return;

      if (type === 'progress') {
        if (signal?.aborted) return;
        onProgress?.({ status: 'initializing', progress: data?.progress });
      } else if (type === 'result') {
        cleanup();
        signal?.removeEventListener('abort', abortHandler);

        if (signal?.aborted) {
          reject(new Error('Transcription cancelled'));
          return;
        }

        createCacheKey({
          filePath: input.filePath,
          fileName: input.fileName,
          fileSize: file.size,
          lastModified: file.lastModified,
          language: input.language || 'auto',
          provider: 'local',
          models: [modelName],
          endpoint: 'local-whisper',
        })
          .then(async (cacheKey) => {
            const cacheRepository = createTranscriptionCacheRepository({
              workspaceDir: input.workspaceHandle,
            });

            const record = {
              key: cacheKey,
              createdAt: new Date().toISOString(),
              sourcePath: input.filePath,
              sourceName: input.fileName,
              sourceSize: file.size,
              sourceLastModified: file.lastModified,
              language: input.language || 'auto',
              provider: 'local',
              models: [modelName],
              response: data,
            };

            await cacheRepository.save(record);

            resolve({
              cacheKey,
              cached: false,
              record,
            });
          })
          .catch(reject);
      } else if (type === 'error') {
        cleanup();
        signal?.removeEventListener('abort', abortHandler);
        reject(new Error(error || 'Transcription failed'));
      }
    };

    worker.addEventListener('message', handler);

    worker.onerror = (err) => {
      cleanup();
      signal?.removeEventListener('abort', abortHandler);
      reject(new Error(err.message || 'Worker error'));
    };

    const initMessage: SttWorkerMessage = {
      type: 'init',
      id,
      data: { modelDirHandle: modelsDir },
    };
    worker.postMessage(initMessage);

    const transcribeMessage: SttWorkerMessage = {
      type: 'transcribe',
      id,
      data: {
        audio: finalAudio,
        modelName,
        language: input.language,
        subtask: 'transcribe',
      },
    };
    worker.postMessage(transcribeMessage, [finalAudio.buffer]);

    onProgress?.({ status: 'transcribing' });
  });
}
