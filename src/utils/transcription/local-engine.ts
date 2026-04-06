import type {
  TranscriptionRequest,
  TranscriptionResult,
  LocalTranscriptionProgress,
  SttWorkerMessage,
  SttWorkerResponse,
} from './types';
import { getSttModelsDir, isModelDownloaded } from './model-storage';
import type { DecodeRequest, DecodeResponse } from '~/utils/audio/types';
import SttWorker from '~/workers/stt.worker.ts?worker';
import AudioDecodeWorker from '~/workers/audio-decode.worker.ts?worker';

export type { LocalTranscriptionProgress };

// Persistent workers to avoid expensive re-initialization
let sharedSttWorker: Worker | null = null;
let sharedDecodeWorker: Worker | null = null;
let sttWorkerInitialized = false;

function getSttWorker(): Worker {
  if (!sharedSttWorker) {
    sharedSttWorker = new SttWorker();
  }
  return sharedSttWorker;
}

function getDecodeWorker(): Worker {
  if (!sharedDecodeWorker) {
    sharedDecodeWorker = new AudioDecodeWorker();
  }
  return sharedDecodeWorker;
}

async function decodeAudioForStt(file: File, signal?: AbortSignal): Promise<Float32Array> {
  const decodeWorker = getDecodeWorker();
  const id = Math.random();

  return new Promise((resolve, reject) => {
    const abortHandler = () => {
      // NOTE: We don't terminate the shared worker, we just reject the promise.
      // The worker might still finish decoding, but we ignore the result.
      reject(new Error('Transcription cancelled'));
    };

    if (signal?.aborted) {
      reject(new Error('Transcription cancelled'));
      return;
    }

    signal?.addEventListener('abort', abortHandler);

    const handler = (e: MessageEvent<DecodeResponse>) => {
      if (e.data.id !== id) return;

      signal?.removeEventListener('abort', abortHandler);
      decodeWorker.removeEventListener('message', handler);

      if (e.data.ok && e.data.result?.sttAudio) {
        resolve(e.data.result.sttAudio);
      } else {
        const errMsg = e.data.error?.message || 'Audio decoding failed';
        reject(new Error(errMsg));
      }
    };

    decodeWorker.addEventListener('message', handler);

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

/**
 * Ensures the STT worker is initialized with the correct model directory.
 */
async function ensureSttWorkerInitialized(modelsDir: FileSystemDirectoryHandle): Promise<void> {
  if (sttWorkerInitialized) return;

  const worker = getSttWorker();
  const id = Math.random();

  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent<SttWorkerResponse>) => {
      const { type, id: msgId } = event.data;
      if (msgId !== id) return;

      if (type === 'init-ok') {
        worker.removeEventListener('message', handler);
        sttWorkerInitialized = true;
        resolve();
      } else if (type === 'error') {
        worker.removeEventListener('message', handler);
        reject(new Error(event.data.error || 'Worker init failed'));
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage({
      type: 'init',
      id,
      data: { modelDirHandle: modelsDir },
    } satisfies SttWorkerMessage);
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

  // Ensure worker is ready (interceptor set up etc)
  await ensureSttWorkerInitialized(modelsDir);

  onProgress?.({ status: 'decoding' });

  const file = input.file instanceof File ? input.file : await input.file.getFile();
  const finalAudio = await decodeAudioForStt(file, input.signal);

  const worker = getSttWorker();
  const id = Math.random();
  const signal = input.signal;

  onProgress?.({ status: 'initializing' });

  return new Promise((resolve, reject) => {
    const abortHandler = () => {
      // NOTE: We don't terminate the shared worker.
      // We rely on the worker's own task management or just ignore results.
      reject(new Error('Transcription cancelled'));
    };

    if (signal?.aborted) {
      reject(new Error('Transcription cancelled'));
      return;
    }

    signal?.addEventListener('abort', abortHandler);

    const handler = (event: MessageEvent<SttWorkerResponse>) => {
      const msg = event.data;
      if (msg.id !== id) return;

      if (msg.type === 'progress') {
        onProgress?.({ status: 'initializing', progress: msg.data.progress });
      } else if (msg.type === 'result') {
        signal?.removeEventListener('abort', abortHandler);
        worker.removeEventListener('message', handler);

        if (signal?.aborted) {
          reject(new Error('Transcription cancelled'));
          return;
        }

        const record = {
          key: 'transient',
          createdAt: new Date().toISOString(),
          sourcePath: input.filePath,
          sourceName: input.fileName,
          sourceSize: file.size,
          sourceLastModified: file.lastModified,
          language: input.language || 'auto',
          provider: 'local',
          models: [modelName],
          response: msg.data,
        };

        resolve({
          cacheKey: 'transient',
          cached: false,
          record,
        });
      } else if (msg.type === 'error') {
        signal?.removeEventListener('abort', abortHandler);
        worker.removeEventListener('message', handler);
        reject(new Error(msg.error || 'Transcription failed'));
      }
    };

    worker.addEventListener('message', handler);

    onProgress?.({ status: 'transcribing' });
    
    worker.postMessage({
      type: 'transcribe',
      id,
      data: {
        audio: finalAudio,
        modelName,
        language: input.language,
        subtask: 'transcribe',
      },
    } satisfies SttWorkerMessage, [finalAudio.buffer]);
  });
}
