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
      labelKey: 'fastcat.hudClip.type',
      disabled: true,
      options: [
        {
          value: 'media_frame',
          labelKey: 'fastcat.hudClip.types.mediaFrame',
        },
      ],
    },
    {
      kind: 'file',
      key: 'background.source.path',
      labelKey: 'fastcat.hudClip.background',
      emptyLabelKey: 'fastcat.hudClip.emptyLayer',
      icon: 'i-heroicons-photo',
    },
    {
      kind: 'scale-xy',
      keyX: 'background.scaleX',
      keyY: 'background.scaleY',
      keyLinked: 'background.scaleLinked',
      labelKey: 'fastcat.properties.scale',
      labelXKey: 'fastcat.properties.scaleX',
      labelYKey: 'fastcat.properties.scaleY',
      defaultValueX: 100,
      defaultValueY: 100,
      defaultLinked: true,
      min: 0,
      max: 1000,
    },
    {
      kind: 'row',
      columns: 2,
      controls: [
        {
          kind: 'number',
          key: 'background.offsetX',
          labelKey: 'fastcat.properties.positionX',
          defaultValue: 0,
          min: -100,
          max: 100,
        },
        {
          kind: 'number',
          key: 'background.offsetY',
          labelKey: 'fastcat.properties.positionY',
          defaultValue: 0,
          min: -100,
          max: 100,
        },
      ],
    },
    {
      kind: 'row',
      columns: 2,
      controls: [
        {
          kind: 'number',
          key: 'background.transitionIn.durationUs',
          labelKey: 'fastcat.properties.fadeIn',
          defaultValue: 0,
          min: 0,
          max: 10000000,
          step: 100000,
        },
        {
          kind: 'number',
          key: 'background.transitionOut.durationUs',
          labelKey: 'fastcat.properties.fadeOut',
          defaultValue: 0,
          min: 0,
          max: 10000000,
          step: 100000,
        },
      ],
    },
    {
      kind: 'file',
      key: 'content.source.path',
      labelKey: 'fastcat.hudClip.content',
      emptyLabelKey: 'fastcat.hudClip.emptyLayer',
      icon: 'i-heroicons-video-camera',
    },
    {
      kind: 'scale-xy',
      keyX: 'content.scaleX',
      keyY: 'content.scaleY',
      keyLinked: 'content.scaleLinked',
      labelKey: 'fastcat.properties.scale',
      labelXKey: 'fastcat.properties.scaleX',
      labelYKey: 'fastcat.properties.scaleY',
      defaultValueX: 100,
      defaultValueY: 100,
      defaultLinked: true,
      min: 0,
      max: 1000,
    },
    {
      kind: 'row',
      columns: 2,
      controls: [
        {
          kind: 'number',
          key: 'content.offsetX',
          labelKey: 'fastcat.properties.positionX',
          defaultValue: 0,
          min: -100,
          max: 100,
        },
        {
          kind: 'number',
          key: 'content.offsetY',
          labelKey: 'fastcat.properties.positionY',
          defaultValue: 0,
          min: -100,
          max: 100,
        },
      ],
    },
    {
      kind: 'row',
      columns: 2,
      controls: [
        {
          kind: 'number',
          key: 'content.transitionIn.durationUs',
          labelKey: 'fastcat.properties.fadeIn',
          defaultValue: 0,
          min: 0,
          max: 10000000,
          step: 100000,
        },
        {
          kind: 'number',
          key: 'content.transitionOut.durationUs',
          labelKey: 'fastcat.properties.fadeOut',
          defaultValue: 0,
          min: 0,
          max: 10000000,
          step: 100000,
        },
      ],
    },
    {
      kind: 'boolean',
      key: 'content.shadow.enabled',
      labelKey: 'fastcat.properties.shadow',
    },
    {
      kind: 'row',
      columns: 2,
      controls: [
        {
          kind: 'number',
          key: 'content.shadow.blur',
          labelKey: 'fastcat.properties.blur',
          defaultValue: 10,
          min: 0,
          max: 100,
        },
        { kind: 'color', key: 'content.shadow.color', labelKey: 'fastcat.properties.color' },
      ],
    },
    {
      kind: 'row',
      columns: 2,
      controls: [
        {
          kind: 'number',
          key: 'content.shadow.offsetX',
          labelKey: 'fastcat.properties.offsetX',
          defaultValue: 5,
          min: -100,
          max: 100,
        },
        {
          kind: 'number',
          key: 'content.shadow.offsetY',
          labelKey: 'fastcat.properties.offsetY',
          defaultValue: 5,
          min: -100,
          max: 100,
        },
      ],
    },
    {
      kind: 'file',
      key: 'frame.source.path',
      labelKey: 'fastcat.hudClip.frame',
      emptyLabelKey: 'fastcat.hudClip.emptyLayer',
      icon: 'i-heroicons-sparkles',
    },
    {
      kind: 'scale-xy',
      keyX: 'frame.scaleX',
      keyY: 'frame.scaleY',
      keyLinked: 'frame.scaleLinked',
      labelKey: 'fastcat.properties.scale',
      labelXKey: 'fastcat.properties.scaleX',
      labelYKey: 'fastcat.properties.scaleY',
      defaultValueX: 100,
      defaultValueY: 100,
      defaultLinked: true,
      min: 0,
      max: 1000,
    },
    {
      kind: 'row',
      columns: 2,
      controls: [
        {
          kind: 'number',
          key: 'frame.offsetX',
          labelKey: 'fastcat.properties.positionX',
          defaultValue: 0,
          min: -100,
          max: 100,
        },
        {
          kind: 'number',
          key: 'frame.offsetY',
          labelKey: 'fastcat.properties.positionY',
          defaultValue: 0,
          min: -100,
          max: 100,
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
