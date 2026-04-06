import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';

// --- Configuration ---
// Disable built-in caching and remote models
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = '/models/';

// This will be set by the main thread
let modelDirHandle: FileSystemDirectoryHandle | null = null;
let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let currentModelName: string | null = null;

/**
 * Brute-force fetch override to intercept model requests
 */
const originalFetch = self.fetch;
self.fetch = (async (url: string | URL, options?: RequestInit) => {
  const urlStr = url.toString();
  
  // Skip internal Vite/HMR or non-model requests
  if (!urlStr.includes('/models/') && (!currentModelName || !urlStr.includes(currentModelName))) {
    return originalFetch(url, options);
  }

  console.log(`[STT Worker] Intercepted fetch: ${urlStr}`);

  if (!modelDirHandle || !currentModelName) {
    console.warn('[STT Worker] Handle or model name missing during fetch');
    return new Response('Not Found', { status: 404 });
  }

  const escapedCurrentModelName = currentModelName.replace(/\//g, '_');
  
  // Extract file path from URL
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

  // Clean up filePath (remove query params etc if any)
  filePath = filePath.split('?')[0]!.split('#')[0]!;

  console.log(`[STT Worker] Mapped to: folder=${escapedCurrentModelName}, file=${filePath}`);
  
  try {
    const modelFolder = await modelDirHandle.getDirectoryHandle(escapedCurrentModelName, { create: false });
    const fileParts = filePath.split('/').filter(Boolean);
    let currentDir = modelFolder;
    for (let i = 0; i < fileParts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(fileParts[i]!, { create: false });
    }
    
    const fileHandle = await currentDir.getFileHandle(fileParts.at(-1)!, { create: false });
    const file = await fileHandle.getFile();
    console.log(`[STT Worker] Success: ${escapedCurrentModelName}/${filePath}`);
    return new Response(file);
  } catch (err) {
    console.warn(`[STT Worker] Not Found in local: ${escapedCurrentModelName}/${filePath}`, err);
    return new Response('Not Found', { status: 404 });
  }
}) as any;

async function initTranscriber(modelName: string) {
  if (transcriber && currentModelName === modelName) return transcriber;

  console.log(`[STT Worker] Initializing pipeline for ${modelName}...`);
  
  // Update local model path to point to our virtual models directory
  env.localModelPath = '/models/';

  try {
    currentModelName = modelName; // Set it before pipeline starts fetching
    transcriber = (await pipeline('automatic-speech-recognition', modelName, {
      device: 'webgpu', // Try WebGPU first
      // quantization: 'quantized', // We already download quantized files
      progress_callback: (progress: any) => {
        self.postMessage({ type: 'progress', data: progress });
      },
    })) as AutomaticSpeechRecognitionPipeline;
    
    return transcriber;
  } catch (err) {
    console.warn('[STT Worker] WebGPU initialization failed, falling back to WASM:', err);
    
    currentModelName = modelName; // Set it again just in case (should already be set)
    transcriber = (await pipeline('automatic-speech-recognition', modelName, {
      device: 'wasm',
      progress_callback: (progress: any) => {
        self.postMessage({ type: 'progress', data: progress });
      },
    })) as AutomaticSpeechRecognitionPipeline;
    
    return transcriber;
  }
}

self.onmessage = async (event) => {
  const { type, data, id } = event.data;

  if (type === 'init') {
    modelDirHandle = data.modelDirHandle;
    self.postMessage({ type: 'init-ok', id });
    return;
  }

  if (type === 'transcribe') {
    const { audio, modelName, language, subtask } = data;

    try {
      const p = await initTranscriber(modelName);

      const result = await p(audio, {
        language,
        subtask: subtask || 'transcribe',
        return_timestamps: true, // Segment-level timestamps (word-level not supported by this model export)
        chunk_length_s: 30,
        stride_length_s: 5,
        callback_function: (output: any) => {
            // Optional: send partial results
            self.postMessage({ type: 'partial-result', id, data: output });
        }
      });

      self.postMessage({ type: 'result', id, data: result });
    } catch (err: any) {
      console.error('[STT Worker] Transcription error:', err);
      self.postMessage({ type: 'error', id, error: err.message });
    }
  }
};
