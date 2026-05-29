/**
 * Video backend dispatcher.
 *
 * В вебе используется существующий VideoCompositor (PixiJS) + WebCodecs пайплайн в video-core worker.
 * В Tauri — новый Rust-композитор на Vello, доступный через Tauri commands.
 *
 * Идея миграции: все вызовы видео-ядра постепенно перевести через этот фасад.
 * Точки подключения сейчас:
 *   - src/composables/monitor/* — превью на мониторе
 *   - src/workers/video-core.worker.ts — экспорт и offscreen render
 *   - src/utils/video-editor/createVideoCoreHostApi.ts — host API
 *
 * Этот файл — только контракт + factory. Реальные реализации в `./web.ts` и `./tauri.ts`.
 */
import type { VideoBackend } from './types';

let cached: VideoBackend | null = null;

export async function getVideoBackend(): Promise<VideoBackend> {
  if (cached) return cached;
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (isTauri) {
    const mod = await import('./tauri');
    cached = mod.createTauriBackend();
  } else {
    const mod = await import('./web');
    cached = mod.createWebBackend();
  }
  return cached;
}

export type { VideoBackend, Scene, Layer, EffectSpec, TransitionSpec } from './types';
