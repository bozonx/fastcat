import type { TranscriptionRequest, TranscriptionResult } from './engine';
import { createCacheKey } from './engine';
import { getSttModelsDir, isModelDownloaded } from './model-storage';
import { createTranscriptionCacheRepository } from '~/repositories/transcription-cache.repository';

// We import the worker using Vite's worker loader syntax
// Note: In Nuxt 4 this might vary depending on configuration, but ?worker is standard Vite.
import SttWorker from '~/workers/stt.worker.ts?worker';

export interface LocalTranscriptionProgress {
    status: 'decoding' | 'initializing' | 'transcribing' | 'done' | 'error';
    progress?: number;
    error?: string;
}

let workerInstance: Worker | null = null;
let currentRequestId = 0;

function getWorker(): Worker {
    if (!workerInstance) {
        workerInstance = new SttWorker();
    }
    return workerInstance;
}

export async function transcribeLocally(
    input: TranscriptionRequest,
    onProgress?: (p: LocalTranscriptionProgress) => void
): Promise<TranscriptionResult> {
    const modelName = input.userSettings.integrations.stt.localModel || 'onnx-community/whisper-tiny';
    
    // 1. Check if model is downloaded
    const modelsDir = await getSttModelsDir(input.workspaceHandle);
    const downloaded = await isModelDownloaded(input.workspaceHandle, modelName);
    if (!downloaded) {
        throw new Error(`Model ${modelName} is not downloaded. Please go to settings to download it.`);
    }

    // 2. Prepare audio (Decode, Mono, Resample in Worker)
    onProgress?.({ status: 'decoding' });
    
    const file = input.file instanceof File ? input.file : await input.file.getFile();

    const decodeWorker = new (await import('~/workers/audio-decode.worker.ts?worker')).default();
    const finalAudio: Float32Array = await new Promise((resolve, reject) => {
        const id = Math.random();
        decodeWorker.onmessage = (e: any) => {
            if (e.data.id === id) {
                if (e.data.ok) resolve(e.data.result.sttAudio);
                else reject(new Error(e.data.error.message));
                decodeWorker.terminate();
            }
        };
        // Passing the Blob/File directly - NO arrayBuffer() here!
        decodeWorker.postMessage({ 
            type: 'decode-stt', 
            id, 
            blob: file, 
            options: { targetSampleRate: 16000 } 
        });
    });

    const worker = getWorker();
    const id = ++currentRequestId;
    const signal = input.signal;

    onProgress?.({ status: 'initializing' });

    return new Promise((resolve, reject) => {
        const abortHandler = () => {
            worker.removeEventListener('message', handler);
            reject(new Error('Transcription cancelled'));
        };

        if (signal?.aborted) {
            return reject(new Error('Transcription cancelled'));
        }
        signal?.addEventListener('abort', abortHandler);

        const handler = (event: MessageEvent) => {
            const { type, id: msgId, data, error } = event.data;
            if (msgId !== id) return;

            if (type === 'progress') {
                if (signal?.aborted) return;
                // data contains progress from HF Transformers.js
                onProgress?.({ status: 'initializing', progress: data.progress });
            } else if (type === 'result') {
                worker.removeEventListener('message', handler);
                signal?.removeEventListener('abort', abortHandler);
                
                if (signal?.aborted) return reject(new Error('Transcription cancelled'));
                const modelNameForCache = `local-${modelName}`;
                createCacheKey({
                    filePath: input.filePath,
                    fileName: input.fileName,
                    fileSize: file.size,
                    lastModified: file.lastModified,
                    language: input.language || 'auto',
                    provider: 'local',
                    models: [modelName],
                    endpoint: 'local-whisper', // dummy endpoint for key
                }).then(async (cacheKey) => {
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
                }).catch(reject);
            } else if (type === 'error') {
                worker.removeEventListener('message', handler);
                reject(new Error(error));
            }
        };

        worker.addEventListener('message', handler);

        // First time, we need to transfer the directory handle to the worker
        worker.postMessage({
            type: 'init',
            id,
            data: { modelDirHandle: modelsDir }
        });

        worker.postMessage({
            type: 'transcribe',
            id,
            data: {
                audio: finalAudio,
                modelName,
                language: input.language,
                subtask: 'transcribe'
            }
        }, [finalAudio.buffer]);
        
        onProgress?.({ status: 'transcribing' });
    });
}
