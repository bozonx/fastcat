import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';

// --- Configuration ---
// Allow remote models for internal purposes (engine files), 
// but our fetch override will force local model files.
env.allowRemoteModels = true;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = '/models/';

// Store WebGPU support status
let isWebGpuAvailable: boolean | null = null;

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
    const modelFolder = await modelDirHandle.getDirectoryHandle(escapedCurrentModelName, { create: false });
    const fileParts = filePath.split('/').filter(Boolean);
    let currentDir = modelFolder;
    for (let i = 0; i < fileParts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(fileParts[i]!, { create: false });
    }
    
    // Try to get the file exactly as requested
    let fileHandle: FileSystemFileHandle;
    try {
        fileHandle = await currentDir.getFileHandle(fileParts.at(-1)!, { create: false });
    } catch (e) {
        // Fallback: if library asks for 'file.onnx', try 'file_quantized.onnx'
        const lastPart = fileParts.at(-1)!;
        if (lastPart.endsWith('.onnx') && !lastPart.includes('_quantized')) {
            const quantizedName = lastPart.replace('.onnx', '_quantized.onnx');
            fileHandle = await currentDir.getFileHandle(quantizedName, { create: false });
        } else {
            throw e;
        }
    }
    
    const file = await fileHandle.getFile();
    console.log(`[STT Worker] Serving local file: ${escapedCurrentModelName}/${filePath} (size: ${file.size} bytes)`);
    return new Response(file);
  } catch (err) {
    console.warn(`[STT Worker] Local file not found: ${escapedCurrentModelName}/${filePath}`);
    return new Response('Not Found', { status: 404 });
  }
}) as any;

async function initTranscriber(modelName: string) {
  if (transcriber && currentModelName === modelName) return transcriber;

  console.log(`[STT Worker] Initializing pipeline for ${modelName}...`);
  
  // Real async check for WebGPU
  if (isWebGpuAvailable === null) {
      const gpu = (self.navigator as any).gpu;
      if (!gpu) {
          isWebGpuAvailable = false;
      } else {
          try {
              const adapter = await gpu.requestAdapter();
              isWebGpuAvailable = !!adapter;
          } catch (e) {
              isWebGpuAvailable = false;
          }
      }
      console.log(`[STT Worker] WebGPU support verified: ${isWebGpuAvailable}`);
  }
  
  // Try WebGPU if available
  if (isWebGpuAvailable) {
    try {
      currentModelName = modelName;
      env.backends.onnx.gpu = true; 
      
      transcriber = (await pipeline('automatic-speech-recognition', modelName, {
        device: 'webgpu',
        quantized: true, 
        progress_callback: (progress: any) => {
          self.postMessage({ type: 'progress', data: progress });
        },
      })) as AutomaticSpeechRecognitionPipeline;
      
      console.log('[STT Worker] Pipeline initialized with WebGPU');
      return transcriber;
    } catch (err: any) {
      console.warn('[STT Worker] WebGPU initialization failed despite adapter presence, falling back to WASM:', err);
      isWebGpuAvailable = false; // Disable for future attempts in this session
    }
  }

  // Fallback to WASM
  transcriber = null;
  currentModelName = null;
  
  try {
      currentModelName = modelName;
      env.backends.onnx.gpu = false; // Force disable GPU for WASM attempts
      
      transcriber = (await pipeline('automatic-speech-recognition', modelName, {
          device: 'wasm',
          quantized: true,
          progress_callback: (progress: any) => {
              self.postMessage({ type: 'progress', data: progress });
          },
      })) as AutomaticSpeechRecognitionPipeline;
      
      console.log('[STT Worker] Pipeline initialized with WASM');
      return transcriber;
  } catch (wasmErr: any) {
      console.error('[STT Worker] WASM initialization also failed:', wasmErr);
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
      const durationS = audio.length / 16000;
      console.log(`[STT Worker] Processing ${modelName}: ${audio.length} samples (${durationS.toFixed(2)}s)`);

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

      console.log(`[STT Worker] Transcription finished. Total chunks: ${Array.isArray((result as any).chunks) ? (result as any).chunks.length : 'N/A'}`);
      self.postMessage({ type: 'result', id, data: result });
    } catch (err: any) {
      console.error(`[STT Worker] Transcription error:`, err);
      self.postMessage({ type: 'error', id, error: err.message || String(err) });
    }
  }
};
