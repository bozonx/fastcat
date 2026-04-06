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

/**
 * Resamples Float32 audio data using linear interpolation.
 */
function resample(audio: Float32Array, currentRate: number, targetRate: number): Float32Array {
    if (currentRate === targetRate) return audio;
    const ratio = currentRate / targetRate;
    const newLength = Math.round(audio.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        const pos = i * ratio;
        const index = Math.floor(pos);
        const fraction = pos - index;
        const a = audio[index] || 0;
        const b = audio[index + 1] || a;
        result[i] = a + (b - a) * fraction;
    }
    return result;
}

/**
 * Merges multiple audio channels into a single mono channel.
 */
function toMono(channels: Float32Array[]): Float32Array {
    if (channels.length === 1) return channels[0]!;
    const len = channels[0]!.length;
    const result = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        let sum = 0;
        for (let ch = 0; ch < channels.length; ch++) {
            sum += channels[ch]![i]!;
        }
        result[i] = sum / channels.length;
    }
    return result;
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

    // 2. Prepare audio (Decode & Resample)
    onProgress?.({ status: 'decoding' });
    
    // We reuse the existing audio-decode mechanism (assuming it's available via a helper or direct worker)
    // For simplicity, we create a temporary worker to decode if we don't have a shared pool.
    // However, the project has audio-decode.worker.ts. Let's use it.
    
    const file = input.file instanceof File ? input.file : await input.file.getFile();
    const arrayBuffer = await file.arrayBuffer();

    const decodeWorker = new (await import('~/workers/audio-decode.worker.ts?worker')).default();
    const decodeResult: any = await new Promise((resolve, reject) => {
        const id = Math.random();
        decodeWorker.onmessage = (e: any) => {
            if (e.data.id === id) {
                if (e.data.ok) resolve(e.data.result);
                else reject(new Error(e.data.error.message));
                decodeWorker.terminate();
            }
        };
        decodeWorker.postMessage({ type: 'decode', id, arrayBuffer }, [arrayBuffer]);
    });

    // Convert to Mono 16kHz Float32
    const mono = toMono(decodeResult.channelBuffers.map((b: any) => new Float32Array(b)));
    const finalAudio = resample(mono, decodeResult.sampleRate, 16000);

    // 3. Transcription via Web Worker
    onProgress?.({ status: 'initializing' });
    const worker = getWorker();
    const id = ++currentRequestId;

    return new Promise((resolve, reject) => {
        const handler = (event: MessageEvent) => {
            const { type, id: msgId, data, error } = event.data;
            if (msgId !== id) return;

            if (type === 'progress') {
                // data contains progress from HF Transformers.js
                onProgress?.({ status: 'initializing', progress: data.progress });
            } else if (type === 'result') {
                worker.removeEventListener('message', handler);
                
                // Compute cache key
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
                        topology: input.resolvedStorageTopology,
                        projectId: input.projectId,
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
