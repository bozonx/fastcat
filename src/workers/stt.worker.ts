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

/**
 * Custom fetch implementation for Transformers.js to load models from FileSystemDirectoryHandle.
 */
env.fetch = async (url: string | URL) => {
  const urlStr = url.toString();

  // If it's a URL to HF, we try to find it in our local handle
  // The URL format from Transformers.js is usually: /models/{model_name}/{file_name}
  // But since we set allowRemoteModels=false, it will use localModelPath.
  
  if (!modelDirHandle) {
    return fetch(url);
  }

  // We expect URLs like "onnx-community_whisper-tiny/config.json"
  // (We use underscores instead of slashes for directory names in model-storage.ts)
  
  const path = urlStr.replace(/^.*\/models\//, '');
  const parts = path.split('/');
  
  try {
    let currentDir = modelDirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(parts[i]!, { create: false });
    }
    const fileHandle = await currentDir.getFileHandle(parts.at(-1)!, { create: false });
    const file = await fileHandle.getFile();
    return new Response(file);
  } catch (err) {
    console.error(`[STT Worker] Failed to fetch local model file: ${path}`, err);
    return fetch(url); // Fallback to real fetch if local fails (though it shouldn't if allowRemoteModels=false)
  }
};

async function initTranscriber(modelName: string) {
  if (transcriber && currentModelName === modelName) return transcriber;

  console.log(`[STT Worker] Initializing pipeline for ${modelName}...`);
  
  // Update local model path to point to our virtual models directory
  env.localModelPath = '/models/';

  try {
    transcriber = (await pipeline('automatic-speech-recognition', modelName, {
      device: 'webgpu', // Try WebGPU first
      // quantization: 'quantized', // We already download quantized files
      progress_callback: (progress: any) => {
        self.postMessage({ type: 'progress', data: progress });
      },
    })) as AutomaticSpeechRecognitionPipeline;
    
    currentModelName = modelName;
    return transcriber;
  } catch (err) {
    console.warn('[STT Worker] WebGPU initialization failed, falling back to WASM:', err);
    
    transcriber = (await pipeline('automatic-speech-recognition', modelName, {
      device: 'wasm',
      progress_callback: (progress: any) => {
        self.postMessage({ type: 'progress', data: progress });
      },
    })) as AutomaticSpeechRecognitionPipeline;
    
    currentModelName = modelName;
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
