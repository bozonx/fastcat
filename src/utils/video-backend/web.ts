/**
 * Web-реализация VideoBackend — тонкая обёртка над существующим VideoCompositor / video-core worker.
 *
 * Пока что — заглушка. По мере перевода вызовов на этот фасад здесь будут адаптеры
 * к старому ядру (createVideoCoreClient + VideoCompositor).
 *
 * Старое веб-ядро остаётся работать как раньше; этот файл — только новый единый вход.
 */
import type { MediaInfo, Scene, VideoBackend } from './types';

export function createWebBackend(): VideoBackend {
  return {
    async openMedia(_path: string): Promise<MediaInfo> {
      throw new Error('web backend openMedia: not migrated yet — use legacy worker-client');
    },
    async renderFrame(_scene: Scene) {
      throw new Error('web backend renderFrame: not migrated yet — use legacy VideoCompositor');
    },
    async dispose() {},
  };
}
