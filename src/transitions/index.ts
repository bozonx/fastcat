import { registerTransition } from './core/registry';
import { dissolveManifest } from './dissolve/manifest';
import { fadeToBlackManifest } from './fade-to-black/manifest';
import { circleManifest } from './circle/manifest';
import { clockManifest } from './clock/manifest';
import { slideManifest } from './slide/manifest';
import { wipeManifest } from './wipe/manifest';
import { barnDoorManifest } from './barn-door/manifest';
import { cubeTransitionManifest } from './cube/manifest';
import { cardSwapTransitionManifest } from './card-swap/manifest';
import { fallingCardTransitionManifest } from './falling-card/manifest';
import { zoomManifest } from './zoom/manifest';
import { bloomManifest } from './bloom/manifest';

import { rectangleManifest } from './rectangle/manifest';
import { blindsManifest } from './blinds/manifest';

export function initTransitions(): void {
  registerTransition(dissolveManifest);
  registerTransition(bloomManifest);
  registerTransition(zoomManifest);
  registerTransition(fadeToBlackManifest);
  registerTransition(wipeManifest);
  registerTransition(slideManifest);
  registerTransition(barnDoorManifest);
  registerTransition(clockManifest);
  registerTransition(circleManifest);
  registerTransition(rectangleManifest);
  registerTransition(blindsManifest);
  registerTransition(cubeTransitionManifest);
  registerTransition(cardSwapTransitionManifest);
  registerTransition(fallingCardTransitionManifest);
}

export * from './core/registry';
export * from './circle/manifest';
export * from './rectangle/manifest';
export * from './clock/manifest';
export * from './dissolve/manifest';
export * from './fade-to-black/manifest';
export * from './slide/manifest';
export * from './wipe/manifest';
export * from './cube/manifest';
export * from './card-swap/manifest';
export * from './falling-card/manifest';
export * from './blinds/manifest';
export * from './bloom/manifest';
