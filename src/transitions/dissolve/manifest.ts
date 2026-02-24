import type { TransitionManifest } from '../core/registry';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface DissolveParams {}

export const dissolveManifest: TransitionManifest<DissolveParams> = {
  type: 'dissolve',
  name: 'Dissolve',
  icon: 'i-heroicons-arrows-right-left',
  defaultDurationUs: 500_000,
  defaultParams: {},
  computeOutOpacity: (progress) => 1 - progress,
  computeInOpacity: (progress) => progress,
};
