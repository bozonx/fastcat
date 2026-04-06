import {
  pipeline,
  env,
  type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';

// --- Configuration ---
// We disable remote models and provide a custom fetch to load from our local storage (OPFS/Tauri)
env.allowRemoteModels = false;
env.allowLocalModels = true;

// This will be set by the main thread
let modelDirHandle: FileSystemDirectoryHandle | null = null;
let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let currentModelName: string | null = null;

env.fetch = async (url: string | URL) => {
  const urlStr = url.toString();
  console.log(`[STT Worker] Requesting URL: ${urlStr} (localModelPath: ${env.localModelPath}, currentModelName: ${currentModelName})`);

  if (!modelDirHandle) {
    console.warn(`[STT Worker] No modelDirHandle set yet, falling back to network for: ${urlStr}`);
    return fetch(url);
  }

  // Handle various URL formats from Transformers.js
  // It could be absolute, relative, or specifically formatted with env.localModelPath
  let fullPath = '';
  const modelsPrefix = '/models/';
  
  if (urlStr.includes(modelsPrefix)) {
    fullPath = urlStr.substring(urlStr.indexOf(modelsPrefix) + modelsPrefix.length);
  } else if (currentModelName && urlStr.includes(currentModelName)) {
    fullPath = urlStr.substring(urlStr.indexOf(currentModelName));
  } else {
    // Just try the last parts if nothing else matches
    const parts = urlStr.split('/');
    fullPath = parts.slice(-3).join('/'); // Try model_org/model_name/file
  }

  if (!currentModelName) {
      console.warn(`[STT Worker] No currentModelName set yet, falling back to network for: ${urlStr}`);
      return fetch(url);
  }

  const escapedCurrentModelName = currentModelName.replace(/\//g, '_');
  
  // Try to extract file path relative to model folder
  let filePath = '';
  if (fullPath.startsWith(currentModelName + '/')) {
      filePath = fullPath.substring(currentModelName.length + 1);
  } else {
      // Fallback: just take the filename
      filePath = fullPath.split('/').pop() || '';
  }
  
  console.log(`[STT Worker] Mapped ${urlStr} to: folder=${escapedCurrentModelName}, file=${filePath}`);
  
  try {
    const modelFolder = await modelDirHandle.getDirectoryHandle(escapedCurrentModelName, { create: false });
    
    const fileParts = filePath.split('/').filter(Boolean);
    let currentDir = modelFolder;
    for (let i = 0; i < fileParts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(fileParts[i]!, { create: false });
    }
    
    const fileHandle = await currentDir.getFileHandle(fileParts.at(-1)!, { create: false });
    const file = await fileHandle.getFile();
    console.log(`[STT Worker] Successfully loaded from cache: ${escapedCurrentModelName}/${filePath}`);
    return new Response(file);
  } catch (err) {
    console.warn(`[STT Worker] Local file not found: ${escapedCurrentModelName}/${filePath}`, err);
    if (!env.allowRemoteModels) {
        return new Response('Not Found', { status: 404 });
    }
    return fetch(url);
  }
};

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
        return_timestamps: 'word', // Word-level timestamps requested
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
