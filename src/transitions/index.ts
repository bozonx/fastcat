import { registerTransition } from './core/registry';
import { dissolveManifest } from './dissolve/manifest';
import { fadeToBlackManifest } from './fade-to-black/manifest';

export function initTransitions(): void {
  registerTransition(dissolveManifest);
  registerTransition(fadeToBlackManifest);
}

export * from './core/registry';
export * from './dissolve/manifest';
export * from './fade-to-black/manifest';
