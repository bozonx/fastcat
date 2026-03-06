import { easeInOutCubic } from '../core/registry';
import type { TransitionManifest } from '../core/registry';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FadeToBlackParams {}

export const fadeToBlackManifest: TransitionManifest<FadeToBlackParams> = {
  type: 'fade-to-black',
  name: 'Fade to Black',
  icon: 'i-heroicons-moon',
  defaultDurationUs: 500_000,
  defaultParams: {},
  computeOutOpacity: (progress, _params, curve) => {
    const p = curve === 'bezier' ? easeInOutCubic(progress) : progress;
    if (p < 0.5) {
      return 1 - p * 2;
    }
    return 0;
  },
  computeInOpacity: (progress, _params, curve) => {
    const p = curve === 'bezier' ? easeInOutCubic(progress) : progress;
    if (p < 0.5) {
      return 0;
    }
    return (p - 0.5) * 2;
  },
};
