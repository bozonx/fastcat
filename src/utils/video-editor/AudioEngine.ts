import { isTauriRuntime } from '~/utils/runtime';
import type { IFileSystemAdapter } from '~/file-manager/core/vfs/types';

import { WebAudioEngine } from './WebAudioEngine';
import { TauriAudioEngine } from './TauriAudioEngine';
import type { IAudioEngine, AudioEngineOptions } from './audio-engine.interface';

export type { AudioEngineClip } from '~/utils/video-editor/audio-engine.types';
export type { IAudioEngine, AudioEngineOptions };
export { WebAudioEngine, TauriAudioEngine };

export function createAudioEngine(options?: {
  getVfs?: () => IFileSystemAdapter | null;
  getAudioCacheVfsPath?: () => string | null;
}): IAudioEngine {
  if (isTauriRuntime()) {
    return new TauriAudioEngine(options);
  }
  return new WebAudioEngine(options);
}
