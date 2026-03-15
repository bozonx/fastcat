import { addMediaTask, MEDIA_TASK_PRIORITIES } from '~/utils/media-task-queue';
import type { ConversionRequest } from '~/types/conversion';
import { MAX_CANVAS_DIMENSION } from '~/utils/conversion/constants';

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
        let finalWidth = targetWidth;
        let finalHeight = targetHeight;
        if (finalWidth > MAX_CANVAS_DIMENSION || finalHeight > MAX_CANVAS_DIMENSION) {
          const ratio = finalWidth / finalHeight;
          if (finalWidth > finalHeight) {
            finalWidth = MAX_CANVAS_DIMENSION;
            finalHeight = Math.round(MAX_CANVAS_DIMENSION / ratio);
          } else {
            finalHeight = MAX_CANVAS_DIMENSION;
            finalWidth = Math.round(MAX_CANVAS_DIMENSION * ratio);
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
