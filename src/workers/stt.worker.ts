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

  // We expect URLs like ".../models/onnx-community/whisper-tiny/config.json"
  // but we store them as "onnx-community_whisper-tiny/config.json"
  
  // Extract path after /models/
  const match = urlStr.match(/\/models\/(.+)$/);
  if (!match) {
    return fetch(url);
  }
  
  const fullPath = match[1]!;
  // We need to escape only the model name part (the first N segments that form the model name)
  // But wait, our downloader escapes the ENTIRE model name including slashes.
  // So "onnx-community/whisper-tiny" becomes "onnx-community_whisper-tiny".
  
  // Let's find how many segments we need to join with underscores.
  // We know the model name being loaded.
  if (!currentModelName) {
      return fetch(url);
  }

  const escapedCurrentModelName = currentModelName.replace(/\//g, '_');
  const filePath = fullPath.substring(currentModelName.length + 1);
  
  try {
    const modelFolder = await modelDirHandle.getDirectoryHandle(escapedCurrentModelName, { create: false });
    
    // filePath might have subfolders (though unlikely for Whisper on local paths)
    const fileParts = filePath.split('/');
    let currentDir = modelFolder;
    for (let i = 0; i < fileParts.length - 1; i++) {
        currentDir = await currentDir.getDirectoryHandle(fileParts[i]!, { create: false });
    }
    
    const fileHandle = await currentDir.getFileHandle(fileParts.at(-1)!, { create: false });
    const file = await fileHandle.getFile();
    return new Response(file);
  } catch (err) {
    console.warn(`[STT Worker] Local file not found: ${fullPath} (mapped to ${escapedCurrentModelName}/${filePath})`, err);
    // If it's not found locally, and we can't fetch remotely, we should return a real 404 instead of letting it hit Nuxt
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
