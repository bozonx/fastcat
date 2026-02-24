import { registerTransition } from './core/registry';
import { dissolveManifest } from './dissolve/manifest';

export function initTransitions(): void {
  registerTransition(dissolveManifest);
}

export * from './core/registry';
export * from './dissolve/manifest';
