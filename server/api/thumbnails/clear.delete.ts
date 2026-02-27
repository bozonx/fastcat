import { defineEventHandler, getQuery } from 'h3';
import { promises as fs } from 'fs';
import path from 'path';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const hash = query.hash as string;

  if (!hash) {
    return { error: 'Missing hash' };
  }

  const baseDir = path.resolve(process.cwd(), 'thumbs', 'video_clip_frames', hash);

  try {
    // Проверяем существование директории
    await fs.access(baseDir);
    // Удаляем директорию со всем содержимым
    await fs.rm(baseDir, { recursive: true, force: true });

    return { success: true };
  } catch (error: any) {
    // Если папка не найдена, это не ошибка
    if (error.code === 'ENOENT') {
      return { success: true };
    }
    console.error('Error clearing thumbnails:', error);
    return { error: error.message };
  }
});
