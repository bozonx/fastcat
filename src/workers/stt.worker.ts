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
  
  if (!modelDirHandle || !currentModelName) {
    return originalFetch(url, options);
  }

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
    const modelFolder = await modelDirHandle.getDirectoryHandle(escapedCurrentModelName, { create: false });
    const fileParts = filePath.split('/').filter(Boolean);
    let currentDir = modelFolder;
    for (let i = 0; i < fileParts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(fileParts[i]!, { create: false });
    }
    
    const fileHandle = await currentDir.getFileHandle(fileParts.at(-1)!, { create: false });
    const file = await fileHandle.getFile();
    return new Response(file);
  } catch (err) {
    return originalFetch(url, options);
  }
}) as any;

async function initTranscriber(modelName: string) {
  if (transcriber && currentModelName === modelName) return transcriber;

  console.log(`[STT Worker] Initializing pipeline for ${modelName}...`);
  
  // Update local model path to point to our virtual models directory
  env.localModelPath = '/models/';

  // Check if WebGPU is supported by the browser before trying
  const isWebGpuSupported = !!(self.navigator as any).gpu;
  
  if (isWebGpuSupported) {
    try {
      currentModelName = modelName;
      transcriber = (await pipeline('automatic-speech-recognition', modelName, {
        device: 'webgpu',
        progress_callback: (progress: any) => {
          self.postMessage({ type: 'progress', data: progress });
        },
      })) as AutomaticSpeechRecognitionPipeline;
      
      console.log('[STT Worker] Pipeline initialized with WebGPU');
      return transcriber;
    } catch (err: any) {
      console.warn('[STT Worker] WebGPU failed to acquire adapter, falling back to CPU:', err);
    }
  } else {
    console.log('[STT Worker] WebGPU not supported by browser, using CPU');
  }

  // Fallback to CPU (WASM)
  transcriber = null;
  currentModelName = null;
  
  try {
      currentModelName = modelName;
      transcriber = (await pipeline('automatic-speech-recognition', modelName, {
          device: 'wasm', 
          dtype: 'fp32', // More compatible for WASM usually
          progress_callback: (progress: any) => {
              self.postMessage({ type: 'progress', data: progress });
          },
      })) as AutomaticSpeechRecognitionPipeline;
      
      console.log('[STT Worker] Pipeline initialized with WASM');
      return transcriber;
  } catch (wasmErr: any) {
      console.error('[STT Worker] WASM initialization failed:', wasmErr);
      throw wasmErr;
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
        return_timestamps: 'word', 
        chunk_length_s: 30,
        stride_length_s: 5,
        callback_function: (output: any) => {
            self.postMessage({ type: 'partial-result', id, data: output });
        }
      });

      self.postMessage({ type: 'result', id, data: result });
    } catch (err: any) {
      console.error(`[STT Worker] Transcription error:`, err);
      self.postMessage({ type: 'error', id, error: err.message || String(err) });
    }
  }
};
