import type { UpdateClipPropertiesCommand } from '~/timeline/commands';
import type {
  ClipTransition,
  TimelineClipItem,
  TimelineDocument,
  TrackKind,
  ClipTransform,
} from '~/timeline/types';
import { cloneValue } from '~/utils/clone';

export type ClipParameterGroup =
  | 'transform'
  | 'opacity'
  | 'animation'
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
    { id: 'text:content', labelKey: 'fastcat.textClip.content' },
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
    { id: 'transform:sourceOrientation', labelKey: 'fastcat.clip.transform.sourceOrientation' },
  ],
  mask: [
    { id: 'mask:source', labelKey: 'fastcat.clip.mask.file' },
    { id: 'mask:mode', labelKey: 'fastcat.clip.mask.mode' },
    { id: 'mask:invert', labelKey: 'fastcat.clip.mask.invert' },
  ],
  audio: [
    { id: 'audio:volume', labelKey: 'fastcat.clip.audio.volume' },
    { id: 'audio:balance', labelKey: 'fastcat.clip.audio.balance' },
    { id: 'audio:fades', labelKey: 'fastcat.clip.audioFade.title' },
  ],
  shape: [
    { id: 'shape:type', labelKey: 'fastcat.shapeClip.type' },
    { id: 'shape:fill', labelKey: 'fastcat.shapeClip.fillColor' },
    { id: 'shape:stroke', labelKey: 'fastcat.shapeClip.stroke' },
    { id: 'shape:config', labelKey: 'fastcat.shapeClip.geometry' },
  ],
  hud: [
    { id: 'hud:background', labelKey: 'fastcat.hudClip.background' },
    { id: 'hud:content', labelKey: 'fastcat.hudClip.content' },
    { id: 'hud:frame', labelKey: 'fastcat.hudClip.frame' },
  ],
  transitions: [
    { id: 'transitions:in', labelKey: 'fastcat.clip.parameters.transitionIn' },
    { id: 'transitions:out', labelKey: 'fastcat.clip.parameters.transitionOut' },
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
  'text:border': ['borderEnabled', 'borderColor', 'borderAlpha', 'borderWidth', 'borderOffset'],
};

const GROUP_LABEL_KEYS: Record<ClipParameterGroup, string> = {
  transform: 'fastcat.clip.parameters.groups.transform',
  opacity: 'fastcat.clip.parameters.groups.opacity',
  animation: 'fastcat.clip.parameters.groups.animation',
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

  const transform = pickDefined(source, ['transform', 'transformActive', 'sourceOrientation']);
  if (transform) groups.transform = transform;

  const opacity = pickDefined(source, ['opacity', 'opacityActive']);
  if (opacity) groups.opacity = opacity;

  // Keyframe tracks copy as one unit (they span transform/opacity/effects).
  const animation = pickDefined(source, ['animations']);
  if (animation) groups.animation = animation;

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

  const background = pickDefined(source, ['backgroundColor']);
  if (background) groups.background = background;

  const text = pickDefined(source, ['text', 'style', 'snapToPixelGrid']);
  if (text) groups.text = text;

  const shape = pickDefined(source, [
    'shapeType',
    'fillColor',
    'strokeColor',
    'strokeWidth',
    'shapeConfig',
    'snapToPixelGrid',
  ]);
  if (shape) groups.shape = shape;

  const hud = pickDefined(source, ['hudType', 'background', 'content', 'frame']);
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

  const snapshot = input.snapshot;
  const available = Object.keys(snapshot.groups) as ClipParameterGroup[];
  return available
    .filter((group) => isGroupApplicable(group, input.targetClip, input.targetTrackKind))
    .map((group) => {
      const subProperties = getAvailableSubProperties({
        group,
        groupValue: snapshot.groups[group],
        targetClip: input.targetClip,
      });
      return {
        id: group,
        labelKey: GROUP_LABEL_KEYS[group],
        selectedByDefault: group !== 'speed',
        subProperties,
      };
    })
    .filter((group) => !GROUP_SUB_PROPERTIES[group.id] || group.subProperties?.length !== 0);
}

function getAvailableSubProperties(input: {
  group: ClipParameterGroup;
  groupValue: Record<string, unknown> | undefined;
  targetClip: TimelineClipItem;
}): ClipParameterSubProperty[] | undefined {
  const subProperties = GROUP_SUB_PROPERTIES[input.group];
  if (!subProperties || !input.groupValue) return subProperties;

  const groupValue = input.groupValue;
  switch (input.group) {
    case 'transform': {
      const sourceTransform = groupValue.transform as ClipTransform | undefined;
      return subProperties.filter((sub) => {
        if (sub.id === 'transform:sourceOrientation') {
          return input.targetClip.clipType === 'media' && 'sourceOrientation' in groupValue;
        }
        if (!sourceTransform) return false;
        if (sub.id === 'transform:anchor') return 'anchor' in sourceTransform;
        if (sub.id === 'transform:scale') return 'scale' in sourceTransform;
        if (sub.id === 'transform:rotation') return 'rotationDeg' in sourceTransform;
        if (sub.id === 'transform:position') return 'position' in sourceTransform;
        if (sub.id === 'transform:crop') return 'crop' in sourceTransform;
        return true;
      });
    }
    case 'text': {
      const sourceStyle = groupValue.style as Record<string, unknown> | undefined;
      return subProperties.filter((sub) => {
        if (sub.id === 'text:content') return 'text' in groupValue;
        const keys = TEXT_SUB_PROP_KEYS[sub.id];
        if (!keys || !sourceStyle) return false;
        return keys.some((key) => key in sourceStyle);
      });
    }
    case 'mask': {
      const sourceMask = groupValue.mask as Record<string, unknown> | undefined;
      return subProperties.filter((sub) => {
        if (!sourceMask) return false;
        if (sub.id === 'mask:source') return 'source' in sourceMask;
        if (sub.id === 'mask:mode') return 'mode' in sourceMask;
        if (sub.id === 'mask:invert') return 'invert' in sourceMask;
        return true;
      });
    }
    case 'audio':
      return subProperties.filter((sub) => {
        if (sub.id === 'audio:volume') return 'audioGain' in groupValue;
        if (sub.id === 'audio:balance') return 'audioBalance' in groupValue;
        if (sub.id === 'audio:fades') {
          return [
            'audioFadeInUs',
            'audioFadeOutUs',
            'audioFadeInCurve',
            'audioFadeOutCurve',
            'audioFadesActive',
          ].some((key) => key in groupValue);
        }
        return true;
      });
    case 'shape':
      return subProperties.filter((sub) => {
        if (sub.id === 'shape:type') return 'shapeType' in groupValue;
        if (sub.id === 'shape:fill') return 'fillColor' in groupValue;
        if (sub.id === 'shape:stroke')
          return 'strokeColor' in groupValue || 'strokeWidth' in groupValue;
        if (sub.id === 'shape:config') return 'shapeConfig' in groupValue;
        return true;
      });
    case 'hud':
      return subProperties.filter((sub) => {
        if (sub.id === 'hud:background') return 'background' in groupValue;
        if (sub.id === 'hud:content') return 'content' in groupValue;
        if (sub.id === 'hud:frame') return 'frame' in groupValue;
        return true;
      });
    case 'transitions':
      return subProperties.filter((sub) => {
        if (sub.id === 'transitions:in') return 'transitionIn' in groupValue;
        if (sub.id === 'transitions:out') return 'transitionOut' in groupValue;
        return true;
      });
    default:
      return subProperties;
  }
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
  // Effects only paste onto a clip that can actually host them: video effects
  // need a video track, audio effects need an audio-capable clip. Without this
  // gate a fan-out paste across a mixed selection would write the source clip's
  // video effects onto an audio clip (and its audio effects onto a text clip),
  // because the effects branch below runs after the per-group applicability loop.
  const canPasteVideoEffects =
    selected.has('videoEffects') &&
    !!input.snapshot.groups.videoEffects &&
    isGroupApplicable('videoEffects', input.targetClip, input.targetTrackKind);
  const canPasteAudioEffects =
    selected.has('audioEffects') &&
    !!input.snapshot.groups.audioEffects &&
    isGroupApplicable('audioEffects', input.targetClip, input.targetTrackKind);
  const nextVideoEffects = canPasteVideoEffects
    ? ((input.snapshot.groups.videoEffects!.effects as TimelineClipItem['effects']) ?? [])
    : targetEffects.filter((effect) => effect?.target !== 'audio');
  const nextAudioEffects = canPasteAudioEffects
    ? ((input.snapshot.groups.audioEffects!.effects as TimelineClipItem['effects']) ?? [])
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
      const hasSubProps = GROUP_SUB_PROPERTIES.transitions!.some((sub) => selected.has(sub.id));
      if (hasSubProps) {
        if (selected.has('transitions:in') && 'transitionIn' in groupValue) {
          patch.transitionIn = cloneValue(groupValue.transitionIn as ClipTransition | null);
        }
        if (selected.has('transitions:out') && 'transitionOut' in groupValue) {
          patch.transitionOut = cloneValue(groupValue.transitionOut as ClipTransition | null);
        }
      } else if (selected.has('transitions')) {
        if ('transitionIn' in groupValue) {
          patch.transitionIn = cloneValue(groupValue.transitionIn as ClipTransition | null);
        }
        if ('transitionOut' in groupValue) {
          patch.transitionOut = cloneValue(groupValue.transitionOut as ClipTransition | null);
        }
      }
      continue;
    }

    if (group === 'videoEffects' || group === 'audioEffects') continue;

    if (group === 'transform') {
      const hasSubProps = GROUP_SUB_PROPERTIES.transform!.some((sub) => selected.has(sub.id));
      if (hasSubProps) {
        const targetTransform = cloneValue(input.targetClip.transform ?? {});
        const sourceTransform = groupValue.transform as ClipTransform | undefined;
        let hasTransformPatch = false;
        if (sourceTransform) {
          if (selected.has('transform:anchor')) {
            setOrDelete(targetTransform, 'anchor', sourceTransform.anchor);
            hasTransformPatch = true;
          }
          if (selected.has('transform:scale')) {
            setOrDelete(targetTransform, 'scale', sourceTransform.scale);
            hasTransformPatch = true;
          }
          if (selected.has('transform:rotation')) {
            setOrDelete(targetTransform, 'rotationDeg', sourceTransform.rotationDeg);
            hasTransformPatch = true;
          }
          if (selected.has('transform:position')) {
            setOrDelete(targetTransform, 'position', sourceTransform.position);
            hasTransformPatch = true;
          }
          if (selected.has('transform:crop')) {
            setOrDelete(targetTransform, 'crop', sourceTransform.crop);
            hasTransformPatch = true;
          }
        }
        if (hasTransformPatch) {
          patch.properties.transform = targetTransform;
        }
        if (
          selected.has('transform:sourceOrientation') &&
          input.targetClip.clipType === 'media' &&
          'sourceOrientation' in groupValue
        ) {
          patch.properties.sourceOrientation = cloneValue(
            groupValue.sourceOrientation as TimelineClipItem['sourceOrientation'],
          );
        }
        if ('transformActive' in groupValue) {
          patch.properties.transformActive = groupValue.transformActive as boolean | undefined;
        }
      } else if (selected.has('transform')) {
        Object.assign(patch.properties, cloneValue(groupValue));
      }
      continue;
    }

    if (group === 'text') {
      const hasSubProps = GROUP_SUB_PROPERTIES.text!.some((sub) => selected.has(sub.id));
      if (hasSubProps) {
        if (selected.has('text:content') && 'text' in groupValue) {
          patch.properties.text = cloneValue(groupValue.text as string | undefined);
        }
        const hasStyleSubProps = Object.keys(TEXT_SUB_PROP_KEYS).some((subId) =>
          selected.has(subId),
        );
        if (hasStyleSubProps) {
          const targetStyle = cloneValue(input.targetClip.style ?? {});
          const sourceStyle = (groupValue.style ?? {}) as Record<string, unknown>;
          for (const subId of Object.keys(TEXT_SUB_PROP_KEYS)) {
            if (selected.has(subId)) {
              const keys = TEXT_SUB_PROP_KEYS[subId];
              if (!keys) continue;
              for (const key of keys) {
                if (sourceStyle[key] !== undefined) {
                  (targetStyle as Record<string, unknown>)[key] = cloneValue(sourceStyle[key]);
                } else {
                  Reflect.deleteProperty(targetStyle as Record<string, unknown>, key);
                }
              }
            }
          }
          patch.properties.style = targetStyle;
        }
      } else if (selected.has('text')) {
        Object.assign(patch.properties, cloneValue(groupValue));
      }
      continue;
    }

    if (group === 'mask') {
      const hasSubProps = GROUP_SUB_PROPERTIES.mask!.some((sub) => selected.has(sub.id));
      if (hasSubProps) {
        const targetMask = cloneValue(input.targetClip.mask ?? {});
        const sourceMask = groupValue.mask as Record<string, unknown> | undefined;
        if (sourceMask) {
          if (selected.has('mask:source')) {
            setOrDelete(targetMask, 'source', sourceMask.source);
          }
          if (selected.has('mask:mode')) {
            setOrDelete(targetMask, 'mode', sourceMask.mode);
          }
          if (selected.has('mask:invert')) {
            setOrDelete(targetMask, 'invert', sourceMask.invert);
          }
        }
        patch.properties.mask = targetMask;
        if ('maskActive' in groupValue) {
          patch.properties.maskActive = groupValue.maskActive as boolean | undefined;
        }
      } else if (selected.has('mask')) {
        Object.assign(patch.properties, cloneValue(groupValue));
      }
      continue;
    }

    if (group === 'audio') {
      const hasSubProps = GROUP_SUB_PROPERTIES.audio!.some((sub) => selected.has(sub.id));
      if (hasSubProps) {
        if (selected.has('audio:volume') && 'audioGain' in groupValue) {
          patch.properties.audioGain = cloneValue(groupValue.audioGain as number | undefined);
        }
        if (selected.has('audio:balance') && 'audioBalance' in groupValue) {
          patch.properties.audioBalance = cloneValue(groupValue.audioBalance as number | undefined);
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
              (patch.properties as Record<string, unknown>)[key] = cloneValue(groupValue[key]);
            }
          }
        }
      } else if (selected.has('audio')) {
        Object.assign(patch.properties, cloneValue(groupValue));
      }
      continue;
    }

    if (group === 'shape') {
      const hasSubProps = GROUP_SUB_PROPERTIES.shape!.some((sub) => selected.has(sub.id));
      if (hasSubProps) {
        if (selected.has('shape:type') && 'shapeType' in groupValue) {
          patch.properties.shapeType = cloneValue(
            groupValue.shapeType as TimelineClipItem['shapeType'],
          );
        }
        if (selected.has('shape:fill') && 'fillColor' in groupValue) {
          patch.properties.fillColor = cloneValue(groupValue.fillColor as string | undefined);
        }
        if (selected.has('shape:stroke')) {
          if ('strokeColor' in groupValue) {
            patch.properties.strokeColor = cloneValue(groupValue.strokeColor as string | undefined);
          }
          if ('strokeWidth' in groupValue) {
            patch.properties.strokeWidth = cloneValue(groupValue.strokeWidth as number | undefined);
          }
        }
        if (selected.has('shape:config') && 'shapeConfig' in groupValue) {
          patch.properties.shapeConfig = cloneValue(
            groupValue.shapeConfig as TimelineClipItem['shapeConfig'],
          );
        }
      } else if (selected.has('shape')) {
        Object.assign(patch.properties, cloneValue(groupValue));
      }
      continue;
    }

    if (group === 'hud') {
      const hasSubProps = GROUP_SUB_PROPERTIES.hud!.some((sub) => selected.has(sub.id));
      if (hasSubProps) {
        if ('hudType' in groupValue) {
          patch.properties.hudType = cloneValue(groupValue.hudType as TimelineClipItem['hudType']);
        }
        if (selected.has('hud:background') && 'background' in groupValue) {
          patch.properties.background = cloneValue(
            groupValue.background as TimelineClipItem['background'],
          );
        }
        if (selected.has('hud:content') && 'content' in groupValue) {
          patch.properties.content = cloneValue(groupValue.content as TimelineClipItem['content']);
        }
        if (selected.has('hud:frame') && 'frame' in groupValue) {
          patch.properties.frame = cloneValue(groupValue.frame as TimelineClipItem['frame']);
        }
      } else if (selected.has('hud')) {
        Object.assign(patch.properties, cloneValue(groupValue));
      }
      continue;
    }

    Object.assign(patch.properties, cloneValue(groupValue));
  }

  if (canPasteVideoEffects || canPasteAudioEffects) {
    patch.properties.effects = cloneValue([
      ...(nextVideoEffects ?? []),
      ...(nextAudioEffects ?? []),
    ]);
  }

  return patch;
}

function setOrDelete(target: object, key: string, value: unknown) {
  const targetRecord = target as Record<string, unknown>;
  if (value === undefined) {
    Reflect.deleteProperty(targetRecord, key);
    return;
  }
  targetRecord[key] = cloneValue(value);
}

/** A single clip that pasted parameters should be applied to. */
export interface ClipParametersApplyTarget {
  trackId: string;
  trackKind: TrackKind;
  clip: TimelineClipItem;
}

/**
 * Expands a paste target into every clip the parameters should be applied to.
 *
 * Paste fans out across the whole selection only when the target clip is itself
 * part of a real multi-selection (>1 selected, target included) — matching how
 * direct multi-selection property edits behave. Otherwise it stays a single-clip
 * paste. Selection ids that no longer resolve to a clip (e.g. markers) are
 * skipped, and an empty resolution falls back to the target so paste never
 * silently no-ops.
 */
export function resolveClipParametersApplyTargets(params: {
  doc: TimelineDocument | null;
  selectedItemIds: string[];
  target: ClipParametersApplyTarget;
}): ClipParametersApplyTarget[] {
  const { doc, selectedItemIds, target } = params;

  // Single-clip paste (or a target outside the selection): apply to the target
  // alone — but never to a locked clip. A locked clip rejects property edits,
  // and because paste is applied as one atomic batch the whole paste would roll
  // back, so we drop it here and paste nothing rather than throwing downstream.
  if (!doc || selectedItemIds.length <= 1 || !selectedItemIds.includes(target.clip.id)) {
    return target.clip.locked ? [] : [target];
  }

  const targets: ClipParametersApplyTarget[] = [];
  for (const id of selectedItemIds) {
    for (const track of doc.tracks) {
      const clip = track.items.find((it) => it.id === id && it.kind === 'clip') as
        | TimelineClipItem
        | undefined;
      if (clip) {
        // Locked clips are skipped rather than aborting the whole fan-out: a
        // single locked clip in an atomic batch throws and rolls back every
        // other clip's paste too. The paste simply lands on the unlocked ones.
        if (!clip.locked) {
          targets.push({ trackId: track.id, trackKind: track.kind, clip });
        }
        break;
      }
    }
  }
  return targets;
}

/**
 * Unions the applicable parameter groups across every paste target. When a
 * paste fans out over a mixed selection (e.g. a video clip and a text clip), the
 * modal must offer every group that applies to *at least one* target — driving
 * it off a single "primary" clip would hide groups the other clips could accept,
 * and pasting off a primary with no applicable groups would silently no-op.
 * Sub-properties are unioned per group; the per-target patch build then drops
 * whatever doesn't apply to each individual clip.
 */
export function getApplicableClipParameterGroupsForTargets(input: {
  snapshot: ClipParametersSnapshot | null | undefined;
  targets: ClipParametersApplyTarget[];
}): ClipParameterGroupOption[] {
  if (!input.snapshot) return [];

  const byId = new Map<ClipParameterGroup, ClipParameterGroupOption>();
  const order: ClipParameterGroup[] = [];

  for (const target of input.targets) {
    const groups = getApplicableClipParameterGroups({
      snapshot: input.snapshot,
      targetClip: target.clip,
      targetTrackKind: target.trackKind,
    });
    for (const group of groups) {
      const existing = byId.get(group.id);
      if (!existing) {
        byId.set(group.id, {
          ...group,
          subProperties: group.subProperties ? [...group.subProperties] : undefined,
        });
        order.push(group.id);
        continue;
      }
      if (group.subProperties && group.subProperties.length > 0) {
        const merged = existing.subProperties ? [...existing.subProperties] : [];
        for (const sub of group.subProperties) {
          if (!merged.some((candidate) => candidate.id === sub.id)) merged.push(sub);
        }
        existing.subProperties = merged;
      }
    }
  }

  return order.map((id) => byId.get(id)!);
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
    case 'animation':
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
