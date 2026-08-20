import { ref } from 'vue';

export interface UploadProgressParams {
  currentFileIndex: number;
  totalFiles: number;
  fileName: string;
  loadedBytes?: number;
  totalBytes?: number;
}

export function useUploadProgress() {
  const isActive = ref(false);
  const progress = ref(0);
  const fileName = ref('');
  const phase = ref('');
  let controller: AbortController | null = null;

  function begin(initialPhase: string, useBackground: boolean): AbortSignal {
    controller = new AbortController();
    isActive.value = !useBackground;
    progress.value = 0;
    fileName.value = '';
    phase.value = initialPhase;
    return controller.signal;
  }

  function end() {
    isActive.value = false;
    controller = null;
  }

  function cancel() {
    controller?.abort();
    isActive.value = false;
  }

  function onProgress(p: UploadProgressParams, fallbackTotalBytes: number) {
    const total = p.totalBytes ?? fallbackTotalBytes;
    progress.value = total > 0 ? (p.loadedBytes ?? 0) / total : p.currentFileIndex / p.totalFiles;
    fileName.value = p.fileName;
  }

  return { isActive, progress, fileName, phase, begin, end, cancel, onProgress };
}
