import { WORKSPACE_TEMP_ROOT_DIR_NAME } from '../storage-roots';

export interface ModelDownloadProgress {
  model: string;
  file: string;
  loaded: number;
  total: number;
  status: 'downloading' | 'saving' | 'done' | 'error';
  error?: string;
}

const HF_BASE = 'https://huggingface.co';

/**
 * List of files required for Whisper models in Transformers.js.
 * We include both onnx-community and Xenova patterns.
 */
const XENOVA_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

export const WHISPER_MODEL_FILES: Record<string, string[]> = {
  'Xenova/whisper-tiny': XENOVA_FILES,
  'Xenova/whisper-base': XENOVA_FILES,
  'Xenova/whisper-small': XENOVA_FILES,
  'Xenova/whisper-medium': XENOVA_FILES,
  'Xenova/whisper-large-v3': XENOVA_FILES,
  'onnx-community/whisper-tiny': [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
  ],
  'onnx-community/whisper-base': [
    'config.json',
    'generation_config.json',
    'preprocessor_config.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'onnx/encoder_model_quantized.onnx',
    'onnx/decoder_model_merged_quantized.onnx',
  ],
};

/**
 * Gets a global directory handle for models to avoid project-folder pollution and duplication.
 * In the browser, this uses the Origin Private File System (OPFS).
 * If a workspaceHandle is provided and we are not in a browser/OPFS context, it falls back to workspace-local vardata.
 */
export async function getSttModelsDir(
  workspaceHandle?: FileSystemDirectoryHandle | null,
): Promise<FileSystemDirectoryHandle> {
  let baseHandle: FileSystemDirectoryHandle;

  if (typeof window !== 'undefined' && navigator.storage?.getDirectory) {
    // Shared storage for the entire Origin (Browser)
    baseHandle = await navigator.storage.getDirectory();
  } else if (workspaceHandle) {
    // Fallback to workspace-local storage
    baseHandle = workspaceHandle;
  } else {
    throw new Error('No storage handle available for models');
  }

  // Ensure 'vardata/models/stt' structure
  const vardata = await baseHandle.getDirectoryHandle(WORKSPACE_TEMP_ROOT_DIR_NAME, {
    create: true,
  });
  const models = await vardata.getDirectoryHandle('models', { create: true });
  return await models.getDirectoryHandle('stt', { create: true });
}

async function getModelDir(
  workspaceHandle: FileSystemDirectoryHandle | null | undefined,
  modelName: string,
  create = false,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const base = await getSttModelsDir(workspaceHandle);
    const dirName = modelName.replace(/\//g, '_');
    return await base.getDirectoryHandle(dirName, { create });
  } catch {
    return null;
  }
}

export async function isModelDownloaded(
  workspaceHandle: FileSystemDirectoryHandle | null | undefined,
  modelName: string,
): Promise<boolean> {
  const requiredFiles = WHISPER_MODEL_FILES[modelName];
  if (!requiredFiles || requiredFiles.length === 0) {
    return false;
  }

  try {
    const dir = await getModelDir(workspaceHandle, modelName, false);
    if (!dir) return false;

    for (const file of requiredFiles) {
      try {
        if (file.includes('/')) {
          const parts = file.split('/');
          let current: FileSystemDirectoryHandle = dir;
          for (let i = 0; i < parts.length - 1; i++) {
            current = await current.getDirectoryHandle(parts[i]!, { create: false });
          }
          await current.getFileHandle(parts.at(-1)!, { create: false });
        } else {
          await dir.getFileHandle(file, { create: false });
        }
      } catch {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

export async function downloadModel(
  workspaceHandle: FileSystemDirectoryHandle | null | undefined,
  modelName: string,
  onProgress?: (progress: ModelDownloadProgress) => void,
): Promise<void> {
  const dir = await getModelDir(workspaceHandle, modelName, true);
  if (!dir) throw new Error(`Failed to create directory for model: ${modelName}`);
  
  const files = WHISPER_MODEL_FILES[modelName];

  if (!files) {
    throw new Error(`Unknown model: ${modelName}`);
  }

  for (const fileName of files) {
    const url = `${HF_BASE}/${modelName}/resolve/main/${fileName}`;

    onProgress?.({
      model: modelName,
      file: fileName,
      loaded: 0,
      total: 0,
      status: 'downloading',
    });

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download ${fileName}: ${response.statusText}`);
    }

    const contentLength = Number(response.headers.get('Content-Length')) || 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Failed to get response reader');

    // Prepare target filesystem handle
    let targetDir: FileSystemDirectoryHandle = dir;
    let targetFileName = fileName;

    if (fileName.includes('/')) {
      const parts = fileName.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        targetDir = await targetDir.getDirectoryHandle(parts[i]!, { create: true });
      }
      targetFileName = parts.at(-1)!;
    }

    const fileHandle = await targetDir.getFileHandle(targetFileName, { create: true });
    const writable = await fileHandle.createWritable();

    try {
      let loaded = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        await writable.write(value);
        loaded += value.length;

        onProgress?.({
          model: modelName,
          file: fileName,
          loaded,
          total: contentLength,
          status: 'downloading',
        });
      }
    } finally {
      await writable.close();
    }

    onProgress?.({
      model: modelName,
      file: fileName,
      loaded: contentLength,
      total: contentLength,
      status: 'done',
    });
  }
}

export async function getModelFile(
  workspaceHandle: FileSystemDirectoryHandle | null | undefined,
  modelName: string,
  fileName: string,
): Promise<File> {
  const dir = await getModelDir(workspaceHandle, modelName, false);
  if (!dir) throw new Error(`Model directory not found: ${modelName}`);

  let targetDir: FileSystemDirectoryHandle = dir;
  let targetFileName = fileName;

  if (fileName.includes('/')) {
    const parts = fileName.split('/');
    for (let i = 0; i < parts.length - 1; i++) {
      targetDir = await targetDir.getDirectoryHandle(parts[i]!, { create: false });
    }
    targetFileName = parts.at(-1)!;
  }

  const fileHandle = await targetDir.getFileHandle(targetFileName, { create: false });
  return await fileHandle.getFile();
}
