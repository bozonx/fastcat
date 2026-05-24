import type { UpdateClipPropertiesCommand } from '~/timeline/commands';
import type { ClipTransition, TimelineClipItem, TrackKind, ClipTransform } from '~/timeline/types';
import { cloneValue } from '~/utils/clone';

export type ClipParameterGroup =
  | 'transform'
  | 'opacity'
  | 'blend'
  | 'mask'
  | 'speed'
  | 'audio'
  | 'videoEffects'
  | 'audioEffects'
  | 'transitions'
  | 'sourceOrientation'
  | 'background'
  | 'text'
  | 'shape'
  | 'hud';

export interface ClipParametersSnapshot {
  clipType: TimelineClipItem['clipType'];
  trackKind: TrackKind;
  groups: Partial<Record<ClipParameterGroup, Record<string, unknown>>>;
}

export interface ClipParametersPatch {
  properties: UpdateClipPropertiesCommand['properties'];
  transitionIn?: ClipTransition | null;
  transitionOut?: ClipTransition | null;
}

export interface ClipParameterSubProperty {
  id: string;
  labelKey: string;
}

export interface ClipParameterGroupOption {
  id: ClipParameterGroup;
  labelKey: string;
  selectedByDefault: boolean;
  subProperties?: ClipParameterSubProperty[];
}

export const GROUP_SUB_PROPERTIES: Record<string, ClipParameterSubProperty[]> = {
  text: [
    { id: 'text:textStyle', labelKey: 'fastcat.textClip.textBlock' },
    { id: 'text:textShadow', labelKey: 'fastcat.textClip.textShadow' },
    { id: 'text:background', labelKey: 'fastcat.textClip.backgroundBlock' },
    { id: 'text:backgroundShadow', labelKey: 'fastcat.textClip.backgroundShadow' },
    { id: 'text:border', labelKey: 'fastcat.textClip.borderBlock' },
  ],
  transform: [
    { id: 'transform:anchor', labelKey: 'fastcat.clip.transform.anchor' },
    { id: 'transform:scale', labelKey: 'fastcat.clip.transform.scale' },
    { id: 'transform:rotation', labelKey: 'fastcat.clip.transform.rotation' },
    { id: 'transform:position', labelKey: 'fastcat.clip.transform.position' },
    { id: 'transform:crop', labelKey: 'fastcat.clip.transform.crop' },
  ],
  audio: [
    { id: 'audio:volume', labelKey: 'fastcat.clip.audio.volume' },
    { id: 'audio:balance', labelKey: 'fastcat.clip.audio.balance' },
    { id: 'audio:fades', labelKey: 'fastcat.clip.audioFade.title' },
  ],
};

export const TEXT_SUB_PROP_KEYS: Record<string, string[]> = {
  'text:textStyle': [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'color',
    'colorAlpha',
    'align',
    'verticalAlign',
    'lineHeight',
    'letterSpacing',
    'padding',
    'paddingLinked',
    'width',
    'height',
  ],
  'text:textShadow': [
    'textShadowEnabled',
    'textShadowColor',
    'textShadowAlpha',
    'textShadowBlur',
    'textShadowSpread',
    'textShadowOffsetX',
    'textShadowOffsetY',
  ],
  'text:background': [
    'backgroundEnabled',
    'backgroundColor',
    'backgroundAlpha',
    'backgroundRadius',
  ],
  'text:backgroundShadow': [
    'backgroundShadowEnabled',
    'backgroundShadowColor',
    'backgroundShadowAlpha',
    'backgroundShadowBlur',
    'backgroundShadowSpread',
    'backgroundShadowOffsetX',
    'backgroundShadowOffsetY',
  ],
  'text:border': ['borderEnabled', 'borderColor', 'borderAlpha', 'borderWidth'],
};

const GROUP_LABEL_KEYS: Record<ClipParameterGroup, string> = {
  transform: 'fastcat.clip.parameters.groups.transform',
  opacity: 'fastcat.clip.parameters.groups.opacity',
  blend: 'fastcat.clip.parameters.groups.blend',
  mask: 'fastcat.clip.parameters.groups.mask',
  speed: 'fastcat.clip.parameters.groups.speed',
  audio: 'fastcat.clip.parameters.groups.audio',
  videoEffects: 'fastcat.clip.parameters.groups.videoEffects',
  audioEffects: 'fastcat.clip.parameters.groups.audioEffects',
  transitions: 'fastcat.clip.parameters.groups.transitions',
  sourceOrientation: 'fastcat.clip.parameters.groups.sourceOrientation',
  background: 'fastcat.clip.parameters.groups.background',
  text: 'fastcat.clip.parameters.groups.text',
  shape: 'fastcat.clip.parameters.groups.shape',
  hud: 'fastcat.clip.parameters.groups.hud',
};

function pickDefined(source: Record<string, unknown>, keys: string[]) {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) {
      result[key] = cloneValue(source[key]);
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function splitEffects(clip: TimelineClipItem) {
  const effects = clip.effects ?? [];
  return {
    videoEffects: effects.filter((effect) => effect?.target !== 'audio'),
    audioEffects: effects.filter((effect) => effect?.target === 'audio'),
  };
}

function canHaveAudioParams(clip: TimelineClipItem, trackKind: TrackKind) {
  return trackKind === 'audio' || clip.clipType === 'media' || clip.clipType === 'timeline';
}

function canHaveVideoParams(trackKind: TrackKind) {
  return trackKind === 'video';
}

export function createClipParametersSnapshot(input: {
  clip: TimelineClipItem;
  trackKind: TrackKind;
}): ClipParametersSnapshot {
  const clip = input.clip;
  const source = clip as unknown as Record<string, unknown>;
  const groups: ClipParametersSnapshot['groups'] = {};

  const transform = pickDefined(source, ['transform', 'transformActive']);
  if (transform) groups.transform = transform;

  const opacity = pickDefined(source, ['opacity', 'opacityActive']);
  if (opacity) groups.opacity = opacity;

  const blend = pickDefined(source, ['blendMode', 'blendModeActive']);
  if (blend) groups.blend = blend;

  const mask = pickDefined(source, ['mask', 'maskActive']);
  if (mask) groups.mask = mask;

  const speed = pickDefined(source, ['speed', 'speedActive']);
  if (speed) groups.speed = speed;

  const audio = pickDefined(source, [
    'audioGain',
    'audioBalance',
    'audioFadeInUs',
    'audioFadeOutUs',
    'audioFadeInCurve',
    'audioFadeOutCurve',
    'audioFadesActive',
  ]);
  if (audio) groups.audio = audio;

  const { videoEffects, audioEffects } = splitEffects(clip);
  if (videoEffects.length > 0) groups.videoEffects = { effects: cloneValue(videoEffects) };
  if (audioEffects.length > 0) groups.audioEffects = { effects: cloneValue(audioEffects) };

  const transitions = pickDefined(source, ['transitionIn', 'transitionOut']);
  if (transitions) groups.transitions = transitions;

  const sourceOrientation = pickDefined(source, ['sourceOrientation']);
  if (sourceOrientation) groups.sourceOrientation = sourceOrientation;

  const background = pickDefined(source, ['backgroundColor']);
  if (background) groups.background = background;

  const text = pickDefined(source, ['style']);
  if (text) groups.text = text;

  const shape = pickDefined(source, [
    'shapeType',
    'fillColor',
    'strokeColor',
    'strokeWidth',
    'shapeConfig',
  ]);
  if (shape) groups.shape = shape;

  const hud = pickDefined(source, ['background', 'content', 'frame']);
  if (hud) groups.hud = hud;

  return {
    clipType: clip.clipType,
    trackKind: input.trackKind,
    groups,
  };
}

export function getApplicableClipParameterGroups(input: {
  snapshot: ClipParametersSnapshot | null | undefined;
  targetClip: TimelineClipItem;
  targetTrackKind: TrackKind;
}): ClipParameterGroupOption[] {
  if (!input.snapshot) return [];

  const available = Object.keys(input.snapshot.groups) as ClipParameterGroup[];
  return available
    .filter((group) => isGroupApplicable(group, input.targetClip, input.targetTrackKind))
    .map((group) => ({
      id: group,
      labelKey: GROUP_LABEL_KEYS[group],
      selectedByDefault: group !== 'speed',
      subProperties: GROUP_SUB_PROPERTIES[group],
    }));
}

export function buildClipParametersPatch(input: {
  snapshot: ClipParametersSnapshot;
  targetClip: TimelineClipItem;
  targetTrackKind: TrackKind;
  groups: string[];
}): ClipParametersPatch {
  const selected = new Set(input.groups);
  const patch: ClipParametersPatch = { properties: {} };
  const targetEffects = input.targetClip.effects ?? [];
  const nextVideoEffects =
    selected.has('videoEffects') && input.snapshot.groups.videoEffects
      ? ((input.snapshot.groups.videoEffects.effects as TimelineClipItem['effects']) ?? [])
      : targetEffects.filter((effect) => effect?.target !== 'audio');
  const nextAudioEffects =
    selected.has('audioEffects') && input.snapshot.groups.audioEffects
      ? ((input.snapshot.groups.audioEffects.effects as TimelineClipItem['effects']) ?? [])
      : targetEffects.filter((effect) => effect?.target === 'audio');

  const activeGroups = new Set<ClipParameterGroup>();
  for (const item of input.groups) {
    const topLevelGroup = item.split(':')[0] as ClipParameterGroup;
    activeGroups.add(topLevelGroup);
  }

  for (const group of activeGroups) {
    if (!isGroupApplicable(group, input.targetClip, input.targetTrackKind)) continue;
    const groupValue = input.snapshot.groups[group];
    if (!groupValue) continue;

    if (group === 'transitions') {
      if ('transitionIn' in groupValue) {
        patch.transitionIn = cloneValue(groupValue.transitionIn as ClipTransition | null);
      }
      if ('transitionOut' in groupValue) {
        patch.transitionOut = cloneValue(groupValue.transitionOut as ClipTransition | null);
      }
      continue;
    }

    if (group === 'videoEffects' || group === 'audioEffects') continue;

    if (group === 'transform') {
      const hasSubProps = GROUP_SUB_PROPERTIES.transform.some((sub) => selected.has(sub.id));
      if (hasSubProps) {
        const targetTransform = cloneValue(input.targetClip.transform ?? {});
        const sourceTransform = groupValue.transform as ClipTransform | undefined;
        if (sourceTransform) {
          if (selected.has('transform:anchor')) {
            targetTransform.anchor = cloneValue(sourceTransform.anchor);
          }
          if (selected.has('transform:scale')) {
            targetTransform.scale = cloneValue(sourceTransform.scale);
          }
          if (selected.has('transform:rotation')) {
            targetTransform.rotationDeg = sourceTransform.rotationDeg;
          }
          if (selected.has('transform:position')) {
            targetTransform.position = cloneValue(sourceTransform.position);
          }
          if (selected.has('transform:crop')) {
            targetTransform.crop = cloneValue(sourceTransform.crop);
          }
        }
        patch.properties.transform = targetTransform;
        if ('transformActive' in groupValue) {
          patch.properties.transformActive = groupValue.transformActive;
        }
      } else if (selected.has('transform')) {
        Object.assign(patch.properties, cloneValue(groupValue));
      }
      continue;
    }

    if (group === 'text') {
      const hasSubProps = GROUP_SUB_PROPERTIES.text.some((sub) => selected.has(sub.id));
      if (hasSubProps) {
        const targetStyle = cloneValue(input.targetClip.style ?? {});
        const sourceStyle = groupValue.style as Record<string, unknown> | undefined;
        if (sourceStyle) {
          for (const subId of Object.keys(TEXT_SUB_PROP_KEYS)) {
            if (selected.has(subId)) {
              const keys = TEXT_SUB_PROP_KEYS[subId];
              for (const key of keys) {
                if (sourceStyle[key] !== undefined) {
                  targetStyle[key] = cloneValue(sourceStyle[key]);
                } else {
                  delete targetStyle[key];
                }
              }
            }
          }
        }
        patch.properties.style = targetStyle;
      } else if (selected.has('text')) {
        Object.assign(patch.properties, cloneValue(groupValue));
      }
      continue;
    }

    if (group === 'audio') {
      const hasSubProps = GROUP_SUB_PROPERTIES.audio.some((sub) => selected.has(sub.id));
      if (hasSubProps) {
        if (selected.has('audio:volume') && 'audioGain' in groupValue) {
          patch.properties.audioGain = cloneValue(groupValue.audioGain);
        }
        if (selected.has('audio:balance') && 'audioBalance' in groupValue) {
          patch.properties.audioBalance = cloneValue(groupValue.audioBalance);
        }
        if (selected.has('audio:fades')) {
          const fadeKeys = [
            'audioFadeInUs',
            'audioFadeOutUs',
            'audioFadeInCurve',
            'audioFadeOutCurve',
            'audioFadesActive',
          ];
          for (const key of fadeKeys) {
            if (key in groupValue) {
              patch.properties[key] = cloneValue(groupValue[key]);
            }
          }
        }
      } else if (selected.has('audio')) {
        Object.assign(patch.properties, cloneValue(groupValue));
      }
      continue;
    }

    Object.assign(patch.properties, cloneValue(groupValue));
  }

  if (selected.has('videoEffects') || selected.has('audioEffects')) {
    patch.properties.effects = cloneValue([
      ...(nextVideoEffects ?? []),
      ...(nextAudioEffects ?? []),
    ]);
  }

  return patch;
}

export function hasClipParametersPatch(patch: ClipParametersPatch) {
  return (
    Object.keys(patch.properties).length > 0 ||
    Object.prototype.hasOwnProperty.call(patch, 'transitionIn') ||
    Object.prototype.hasOwnProperty.call(patch, 'transitionOut')
  );
}

function isGroupApplicable(
  group: ClipParameterGroup,
  targetClip: TimelineClipItem,
  targetTrackKind: TrackKind,
) {
  switch (group) {
    case 'transform':
    case 'opacity':
    case 'blend':
    case 'mask':
    case 'transitions':
      return canHaveVideoParams(targetTrackKind);
    case 'speed':
      return targetClip.clipType === 'media' || targetClip.clipType === 'timeline';
    case 'audio':
    case 'audioEffects':
      return canHaveAudioParams(targetClip, targetTrackKind);
    case 'videoEffects':
      return canHaveVideoParams(targetTrackKind);
    case 'sourceOrientation':
      return targetClip.clipType === 'media';
    case 'background':
      return targetClip.clipType === 'background';
    case 'text':
      return targetClip.clipType === 'text';
    case 'shape':
      return targetClip.clipType === 'shape';
    case 'hud':
      return targetClip.clipType === 'hud';
    default:
      return false;
  }
}
