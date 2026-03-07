import { registerTransition } from './core/registry';
import { dissolveManifest } from './dissolve/manifest';
import { fadeToBlackManifest } from './fade-to-black/manifest';
import { circleManifest } from './circle/manifest';
import { clockManifest } from './clock/manifest';
import { slideManifest } from './slide/manifest';
import { wipeManifest } from './wipe/manifest';
import { cubeTransitionManifest } from './cube/manifest';
import { flipTransitionManifest } from './flip/manifest';

export function initTransitions(): void {
  registerTransition(dissolveManifest);
  registerTransition(fadeToBlackManifest);
  registerTransition(slideManifest);
  registerTransition(clockManifest);
  registerTransition(circleManifest);
  registerTransition(wipeManifest);
  registerTransition(cubeTransitionManifest);
  registerTransition(flipTransitionManifest);
}

export * from './core/registry';
export * from './circle/manifest';
export * from './clock/manifest';
export * from './dissolve/manifest';
export * from './fade-to-black/manifest';
export * from './slide/manifest';
export * from './wipe/manifest';
export * from './cube/manifest';
export * from './flip/manifest';
