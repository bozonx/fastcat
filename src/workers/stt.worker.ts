import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';

// --- Configuration ---
// Strictly local models
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.useBrowserCache = false;
env.localModelPath = '/models/';

// Force disable GPU globally to avoid erratic WebGPU adapter failures blocking the worker
env.backends.onnx.gpu = false;

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

  console.log(`[STT Worker] Initializing pipeline (FORCED WASM, QUANTIZED) for ${modelName}...`);
  
  try {
    currentModelName = modelName;
    transcriber = (await pipeline('automatic-speech-recognition', modelName, {
      device: 'wasm',
      quantized: true, // IMPORTANT: match our downloaded files
      progress_callback: (progress: any) => {
        self.postMessage({ type: 'progress', data: progress });
      },
    })) as AutomaticSpeechRecognitionPipeline;
    
    console.log('[STT Worker] Pipeline initialized with WASM');
    return transcriber;
  } catch (err: any) {
    console.error('[STT Worker] WASM initialization failed:', err);
    throw err;
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
