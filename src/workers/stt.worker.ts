import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import type {
  SttWorkerInitMessage,
  SttWorkerTranscribeMessage,
  SttWorkerResponse,
} from '~/utils/transcription/types';

env.allowRemoteModels = true;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = '/models/';

let isWebGpuAvailable: boolean | null = null;
let modelDirHandle: FileSystemDirectoryHandle | null = null;
let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let currentModelName: string | null = null;

const originalFetch = self.fetch;
self.fetch = (async (url: string | URL, options?: RequestInit) => {
  const urlStr = url.toString();

  if (!urlStr.includes('/models/') || !modelDirHandle || !currentModelName) {
    return originalFetch(url, options);
  }

  console.log(`[STT Worker] Intercepted local fetch: ${urlStr}`);

  const escapedCurrentModelName = currentModelName.replace(/\//g, '_');

  let filePath = '';
  const modelsPrefix = '/models/';
  if (urlStr.includes(modelsPrefix)) {
    const fullPath = urlStr.substring(urlStr.indexOf(modelsPrefix) + modelsPrefix.length);
    if (fullPath.startsWith(currentModelName + '/')) {
      filePath = fullPath.substring(currentModelName.length + 1);
    } else {
      filePath = fullPath.split('/').pop() || '';
    }
  } else {
    filePath = urlStr.split('/').pop() || '';
  }

  filePath = filePath.split('?')[0]!.split('#')[0]!;

  try {
    const modelFolder = await modelDirHandle.getDirectoryHandle(escapedCurrentModelName, {
      create: false,
    });
    const fileParts = filePath.split('/').filter(Boolean);
    let currentDir = modelFolder;
    for (let i = 0; i < fileParts.length - 1; i++) {
      currentDir = await currentDir.getDirectoryHandle(fileParts[i]!, { create: false });
    }

    let fileHandle: FileSystemFileHandle;
    try {
      fileHandle = await currentDir.getFileHandle(fileParts.at(-1)!, { create: false });
    } catch {
      const lastPart = fileParts.at(-1)!;
      if (lastPart.endsWith('.onnx') && !lastPart.includes('_quantized')) {
        const quantizedName = lastPart.replace('.onnx', '_quantized.onnx');
        fileHandle = await currentDir.getFileHandle(quantizedName, { create: false });
      } else {
        throw new Error(`File not found: ${lastPart}`);
      }
    }

    const file = await fileHandle.getFile();
    console.log(
      `[STT Worker] Serving local file: ${escapedCurrentModelName}/${filePath} (size: ${file.size} bytes)`,
    );
    return new Response(file);
  } catch (err) {
    console.warn(`[STT Worker] Local file not found: ${escapedCurrentModelName}/${filePath}`);
    return new Response('Not Found', { status: 404 });
  }
}) as typeof self.fetch;

async function initTranscriber(modelName: string): Promise<AutomaticSpeechRecognitionPipeline> {
  if (transcriber && currentModelName === modelName) {
    return transcriber;
  }

  console.log(`[STT Worker] Initializing pipeline for ${modelName}...`);

  if (isWebGpuAvailable === null) {
    const gpu = (self.navigator as any).gpu;
    if (!gpu) {
      isWebGpuAvailable = false;
    } else {
      try {
        const adapter = await gpu.requestAdapter();
        isWebGpuAvailable = !!adapter;
      } catch {
        isWebGpuAvailable = false;
      }
    }
    console.log(`[STT Worker] WebGPU support verified: ${isWebGpuAvailable}`);
  }

  if (isWebGpuAvailable) {
    try {
      currentModelName = modelName;
      env.backends.onnx.gpu = true;

      transcriber = (await pipeline('automatic-speech-recognition', modelName, {
        device: 'webgpu',
        quantized: true,
        progress_callback: (progress: { progress?: number }) => {
          self.postMessage({
            type: 'progress',
            id: 0,
            data: { progress: progress.progress || 0 },
          } satisfies SttWorkerResponse);
        },
      } as any)) as AutomaticSpeechRecognitionPipeline;

      console.log('[STT Worker] Pipeline initialized with WebGPU');
      return transcriber;
    } catch (err: unknown) {
      console.warn('[STT Worker] WebGPU initialization failed, falling back to WASM:', err);
      isWebGpuAvailable = false;
      transcriber = null;
      currentModelName = null;
    }
  }

  currentModelName = modelName;
  env.backends.onnx.gpu = false;

  transcriber = (await pipeline('automatic-speech-recognition', modelName, {
    device: 'wasm',
    quantized: true,
    progress_callback: (progress: { progress?: number }) => {
      self.postMessage({
        type: 'progress',
        id: 0,
        data: { progress: progress.progress || 0 },
      } satisfies SttWorkerResponse);
    },
  } as any)) as AutomaticSpeechRecognitionPipeline;

  console.log('[STT Worker] Pipeline initialized with WASM');
  return transcriber;
}

let taskQueue = Promise.resolve();
let pendingTranscription: {
  id: number;
  audio: Float32Array;
  modelName: string;
  language?: string;
  subtask?: string;
} | null = null;

self.onmessage = async (event: MessageEvent<SttWorkerInitMessage | SttWorkerTranscribeMessage>) => {
  const { type, id, data } = event.data;

  if (type === 'init') {
    modelDirHandle = data.modelDirHandle;
    self.postMessage({ type: 'init-ok', id } satisfies SttWorkerResponse);
    return;
  }

  if (type === 'transcribe') {
    const { audio, modelName, language, subtask } = data;

    taskQueue = taskQueue
      .then(async () => {
        pendingTranscription = { id, audio, modelName, language, subtask };

        const durationS = audio.length / 16000;
        console.log(
          `[STT Worker] Processing ${modelName}: ${audio.length} samples (${durationS.toFixed(2)}s)`,
        );

        const p = await initTranscriber(modelName);

        const result = await p(audio, {
          language,
          subtask: subtask || 'transcribe',
          return_timestamps: 'word',
          chunk_length_s: 30,
          stride_length_s: 5,
          callback_function: (output: unknown) => {
            self.postMessage({
              type: 'partial-result',
              id,
              data: output,
            } satisfies SttWorkerResponse);
          },
        } as any);

        console.log(
          `[STT Worker] Transcription finished. Total chunks: ${Array.isArray((result as any).chunks) ? (result as any).chunks.length : 'N/A'}`,
        );
        self.postMessage({ type: 'result', id, data: result } satisfies SttWorkerResponse);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[STT Worker] Transcription error:`, err);
        self.postMessage({ type: 'error', id, error: message } satisfies SttWorkerResponse);
      })
      .finally(() => {
        pendingTranscription = null;
      });
  }
};
