import { addMediaTask, MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';
import type { ConversionRequest } from '~/types/conversion';

export async function executeImageConversion(params: {
  file: File;
  targetHandle: FileSystemFileHandle;
  request: ConversionRequest;
  taskId: string;
  isCancelRequested: () => boolean;
}) {
  return addMediaTask(
    async () => {
      if (params.isCancelRequested()) {
        return;
      }

      const bitmap = await createImageBitmap(params.file);
      try {
        const canvas = document.createElement('canvas');

        const targetWidth = Math.max(1, params.request.image?.width || bitmap.width);
        const targetHeight = Math.max(1, params.request.image?.height || bitmap.height);

        // Check if canvas size exceeds limits
        const MAX_DIM = 16384;
        let finalWidth = targetWidth;
        let finalHeight = targetHeight;
        if (finalWidth > MAX_DIM || finalHeight > MAX_DIM) {
          const ratio = finalWidth / finalHeight;
          if (finalWidth > finalHeight) {
            finalWidth = MAX_DIM;
            finalHeight = Math.round(MAX_DIM / ratio);
          } else {
            finalHeight = MAX_DIM;
            finalWidth = Math.round(MAX_DIM * ratio);
          }
        }

        canvas.width = finalWidth;
        canvas.height = finalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not create canvas context');
        ctx.drawImage(bitmap, 0, 0, finalWidth, finalHeight);

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, 'image/webp', (params.request.image?.quality ?? 80) / 100);
        });

        if (!blob) throw new Error('Failed to create webp blob');

        const writable = await params.targetHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } finally {
        bitmap.close();
      }
    },
    { priority: MEDIA_TASK_PRIORITIES.conversionInteractive },
  );
}
