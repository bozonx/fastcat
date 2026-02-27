import { promises as fs } from 'fs';
import path from 'path';

export default defineEventHandler(async (event) => {
  const filePath = event.context.params?.path;
  
  if (!filePath) {
    throw createError({ statusCode: 400, statusMessage: 'Path is required' });
  }

  // Защита от выхода за пределы директории
  const normalizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const absolutePath = path.resolve(process.cwd(), 'thumbs', 'video_clip_frames', normalizedPath);

  // Убедимся, что путь все еще внутри папки thumbs/video_clip_frames
  if (!absolutePath.startsWith(path.resolve(process.cwd(), 'thumbs', 'video_clip_frames'))) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  try {
    const file = await fs.readFile(absolutePath);
    setResponseHeader(event, 'Content-Type', 'image/webp');
    setResponseHeader(event, 'Cache-Control', 'public, max-age=31536000, immutable');
    return file;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw createError({ statusCode: 404, statusMessage: 'File not found' });
    }
    throw createError({ statusCode: 500, statusMessage: 'Internal server error' });
  }
});
