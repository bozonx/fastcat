/**
 * Tauri-реализация VideoBackend: говорит с Rust-композитором через invoke().
 *
 * ВАЖНО: не импортирует ничего из старого web-композитора (VideoCompositor / Pixi / WebCodecs).
 * Это гарантирует, что Vite не подцепит web-ядро в Tauri-сборке.
 */
import { invoke } from '@tauri-apps/api/core';
import type { MediaInfo, Scene, VideoBackend } from './types';

export function createTauriBackend(): VideoBackend {
  return {
    async openMedia(path: string): Promise<MediaInfo> {
      return await invoke<MediaInfo>('media_open', { params: { path } });
    },

    async renderFrame(scene: Scene) {
      const result = await invoke<{ width: number; height: number; png_base64: string | null }>(
        'compositor_render_frame',
        { scene },
      );
      let bitmap: ImageBitmap | null = null;
      if (result.png_base64) {
        const bin = atob(result.png_base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      }
      return { width: result.width, height: result.height, bitmap };
    },

    async dispose() {
      // no-op: движок живёт пока живёт Tauri-процесс
    },
  };
}
