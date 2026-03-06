import { registerTransition } from './core/registry';
import { dissolveManifest } from './dissolve/manifest';
import { fadeToBlackManifest } from './fade-to-black/manifest';
import { wipeManifest } from './wipe/manifest';

export function initTransitions(): void {
  registerTransition(dissolveManifest);
  registerTransition(fadeToBlackManifest);
  registerTransition(wipeManifest);
}

export * from './core/registry';
export * from './dissolve/manifest';
export * from './fade-to-black/manifest';
export * from './wipe/manifest';
