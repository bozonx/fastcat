import { promises as fs } from 'fs';
import path from 'path';

export default defineEventHandler(async (event) => {
  const formData = await readMultipartFormData(event);

  if (!formData) {
    return { error: 'No form data' };
  }

  let hash = '';
  let timestamp = '';
  let fileData: Buffer | undefined;

  for (const field of formData) {
    if (field.name === 'hash') hash = field.data.toString();
    if (field.name === 'timestamp') timestamp = field.data.toString();
    if (field.name === 'file') fileData = field.data;
  }

  if (!hash || !timestamp || !fileData) {
    return { error: 'Missing required fields' };
  }

  // Путь от корня воркспейса
  const baseDir = path.resolve(process.cwd(), 'thumbs', 'video_clip_frames', hash);

  try {
    await fs.mkdir(baseDir, { recursive: true });
    const filePath = path.join(baseDir, `${timestamp}.webp`);
    await fs.writeFile(filePath, fileData);

    return { success: true, path: `/thumbs/video_clip_frames/${hash}/${timestamp}.webp` };
  } catch (error: any) {
    console.error('Error saving thumbnail:', error);
    return { error: error.message };
  }
});
