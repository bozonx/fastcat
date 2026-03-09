import type { ParamControl } from '~/components/properties/params';
import type { HudType } from '~/timeline/types';

export interface HudManifest {
  type: HudType;
  name: string;
  icon: string;
  controls: ParamControl[];
}

const hudRegistry = new Map<HudType, HudManifest>();

function registerHud(manifest: HudManifest) {
  hudRegistry.set(manifest.type, manifest);
}

registerHud({
  type: 'media_frame',
  name: 'Media Frame',
  icon: 'i-heroicons-photo',
  controls: [
    {
      kind: 'select',
      key: 'hudType',
      labelKey: 'granVideoEditor.hudClip.type',
      disabled: true,
      options: [
        {
          value: 'media_frame',
          labelKey: 'granVideoEditor.hudClip.types.mediaFrame',
        },
      ],
    },
    {
      kind: 'row',
      columns: 2,
      controls: [
        {
          kind: 'file',
          key: 'backgroundSourcePath',
          labelKey: 'granVideoEditor.hudClip.background',
          emptyLabelKey: 'granVideoEditor.hudClip.emptyLayer',
          icon: 'i-heroicons-photo',
        },
        {
          kind: 'file',
          key: 'contentSourcePath',
          labelKey: 'granVideoEditor.hudClip.content',
          emptyLabelKey: 'granVideoEditor.hudClip.emptyLayer',
          icon: 'i-heroicons-video-camera',
        },
      ],
    },
  ],
});

export function getHudManifest(type: HudType): HudManifest | undefined {
  return hudRegistry.get(type);
}

export function getAllHudManifests(): HudManifest[] {
  return Array.from(hudRegistry.values());
}
