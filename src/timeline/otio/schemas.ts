import { z } from 'zod';

export const ClipScaleSchema = z.object({
  x: z.number().catch(1),
  y: z.number().catch(1),
  linked: z.boolean().optional(),
});

export const ClipAnchorPresetSchema = z.enum([
  'center',
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
  'custom',
]);

export const ClipAnchorSchema = z.object({
  preset: ClipAnchorPresetSchema.catch('center'),
  x: z.number().optional(),
  y: z.number().optional(),
});

export const ClipPositionSchema = z.object({
  x: z.number().catch(0),
  y: z.number().catch(0),
});

export const ClipCropSchema = z.object({
  top: z.number().min(0).max(100).optional(),
  bottom: z.number().min(0).max(100).optional(),
  left: z.number().min(0).max(100).optional(),
  right: z.number().min(0).max(100).optional(),
});

export const ClipTransformSchema = z.object({
  scale: ClipScaleSchema.optional(),
  rotationDeg: z.number().optional(),
  position: ClipPositionSchema.optional(),
  anchor: ClipAnchorSchema.optional(),
  crop: ClipCropSchema.optional(),
});

export const ClipSourceOrientationSchema = z.enum(['auto', '0', '90', '180', '270']);

export const ClipFitModeSchema = z.enum(['fit', 'fill', 'stretch', 'original']);

export const ClipMaskSchema = z.object({
  source: z.object({ path: z.string() }).optional(),
  mode: z.enum(['alpha', 'luma']).optional(),
  invert: z.boolean().optional(),
});

export const TextClipStyleSchema = z.object({
  width: z.number().optional(),
  fontFamily: z.string().optional(),
  fontSize: z.number().optional(),
  fontWeight: z.union([z.string(), z.number()]).optional(),
  color: z.string().optional(),
  colorAlpha: z.number().optional(),
  colorBlendMode: z.enum(['normal', 'add', 'multiply', 'screen', 'darken', 'lighten']).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  verticalAlign: z.enum(['top', 'middle', 'bottom']).optional(),
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional(),
  backgroundEnabled: z.boolean().optional(),
  backgroundColor: z.string().optional(),
  backgroundAlpha: z.number().optional(),
  backgroundRadius: z.number().optional(),
  backgroundBlendMode: z
    .enum(['normal', 'add', 'multiply', 'screen', 'darken', 'lighten'])
    .optional(),
  borderEnabled: z.boolean().optional(),
  borderColor: z.string().optional(),
  borderAlpha: z.number().optional(),
  borderWidth: z.number().optional(),
  padding: z.any().optional(),
});

export const ShapeConfigSchema = z.object({
  squashX: z.number().optional(),
  squashY: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  cornerRadius: z.number().optional(),
  baseLength: z.number().optional(),
  vertexOffset: z.number().optional(),
  rays: z.number().optional(),
  innerRadius: z.number().optional(),
  cloudType: z.union([z.literal(1), z.literal(2)]).optional(),
  pointerSharpness: z.number().optional(),
  pointerAngle: z.number().optional(),
  pointerX: z.number().optional(),
  pointerDirection: z.enum(['left', 'right']).optional(),
});

export const ClipTransitionFastCatSchema = z.object({
  type: z.string().trim().min(1),
  durationUs: z.number().min(0),
  mode: z.enum(['adjacent', 'background', 'transparent']).optional(),
  isOverridden: z.boolean().optional(),
  curve: z.enum(['linear', 'smooth']).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const ClipEffectParamsSchema = z.object({
  id: z.string().trim().min(1),
  type: z.string().trim().min(1),
  enabled: z.boolean().optional(),
  target: z.enum(['video', 'audio']).optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

// Legacy flat effect schema (spread params)
export const ClipEffectFastCatSchema = z
  .object({
    id: z.string().trim().min(1),
    type: z.string().trim().min(1),
    enabled: z.boolean().optional(),
    target: z.enum(['video', 'audio']).optional(),
  })
  .passthrough();

export const HudMediaParamsSchema = z.object({
  source: z.object({ path: z.string() }).optional(),
  sourceKind: z.enum(['media', 'timeline']).optional(),
  transitionIn: ClipTransitionFastCatSchema.optional(),
  transitionOut: ClipTransitionFastCatSchema.optional(),
  effects: z.array(ClipEffectFastCatSchema).optional(),
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
  offsetX: z.number().optional(),
  offsetY: z.number().optional(),
  shadow: z
    .object({
      enabled: z.boolean().optional(),
      blur: z.number().optional(),
      color: z.string().optional(),
      offsetX: z.number().optional(),
      offsetY: z.number().optional(),
      alpha: z.number().optional(),
    })
    .optional(),
});

export const TimelineClipTypeSchema = z.enum([
  'media',
  'timeline',
  'adjustment',
  'background',
  'text',
  'shape',
  'hud',
]);

export const TimelineBlendModeSchema = z.enum([
  'normal',
  'add',
  'multiply',
  'screen',
  'darken',
  'lighten',
]);

export const AudioFadeCurveSchema = z.enum(['linear', 'logarithmic']);

// ---------------------------------------------------------------------------
// Discriminated typeData schemas
// ---------------------------------------------------------------------------

export const TypeDataBackgroundSchema = z.object({
  kind: z.literal('background'),
  color: z.string().optional(),
});

export const TypeDataTextSchema = z.object({
  kind: z.literal('text'),
  text: z.string().optional(),
  style: TextClipStyleSchema.optional(),
});

export const TypeDataShapeSchema = z.object({
  kind: z.literal('shape'),
  type: z
    .enum(['square', 'circle', 'triangle', 'star', 'cloud', 'speech_bubble', 'bang'])
    .optional(),
  fillColor: z.string().optional(),
  strokeColor: z.string().optional(),
  strokeWidth: z.number().min(0).optional(),
  config: ShapeConfigSchema.optional(),
});

export const TypeDataHudSchema = z.object({
  kind: z.literal('hud'),
  type: z.enum(['media_frame']).optional(),
  background: HudMediaParamsSchema.optional(),
  content: HudMediaParamsSchema.optional(),
  frame: HudMediaParamsSchema.optional(),
});

export const TypeDataDiscriminatedSchema = z.discriminatedUnion('kind', [
  TypeDataBackgroundSchema,
  TypeDataTextSchema,
  TypeDataShapeSchema,
  TypeDataHudSchema,
]);

// Legacy non-discriminated typeData schema (for backward-compatible parsing)
export const TypeDataLegacySchema = z.object({
  background: z.object({ color: z.string().optional() }).optional(),
  text: z.object({ text: z.string().optional(), style: TextClipStyleSchema.optional() }).optional(),
  shape: z
    .object({
      type: z
        .enum(['square', 'circle', 'triangle', 'star', 'cloud', 'speech_bubble', 'bang'])
        .optional(),
      fillColor: z.string().optional(),
      strokeColor: z.string().optional(),
      strokeWidth: z.number().min(0).optional(),
      config: ShapeConfigSchema.optional(),
    })
    .optional(),
  hud: z
    .object({
      type: z.enum(['media_frame']).optional(),
      background: HudMediaParamsSchema.optional(),
      content: HudMediaParamsSchema.optional(),
      frame: HudMediaParamsSchema.optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Grouped metadata schemas (new format)
// ---------------------------------------------------------------------------

export const TimelineClipRoundtripSchema = z.object({
  timelineRange: z.object({ startUs: z.number(), durationUs: z.number() }).optional(),
  sourceRange: z.object({ startUs: z.number(), durationUs: z.number() }).optional(),
});

export const TimelineClipFastCatMetaSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    clipType: TimelineClipTypeSchema.optional(),
    source: z
      .object({
        durationUs: z.number().min(0).optional(),
      })
      .optional(),
    playback: z
      .object({
        speed: z.number().min(-10).max(10).optional(),
        freezeFrameSourceUs: z.number().min(0).optional(),
      })
      .optional(),
    audio: z
      .object({
        gain: z.number().min(0).max(10).optional(),
        balance: z.number().min(-1).max(1).optional(),
        fadeInUs: z.number().min(0).optional(),
        fadeOutUs: z.number().min(0).optional(),
        fadeInCurve: AudioFadeCurveSchema.optional(),
        fadeOutCurve: AudioFadeCurveSchema.optional(),
        muted: z.boolean().optional(),
        waveformMode: z.enum(['half', 'full']).optional(),
        showWaveform: z.boolean().optional(),
        fromVideoDisabled: z.boolean().optional(),
      })
      .optional(),
    visual: z
      .object({
        opacity: z.number().min(0).max(1).optional(),
        blendMode: TimelineBlendModeSchema.optional(),
        showThumbnails: z.boolean().optional(),
        isImage: z.boolean().optional(),
        sourceOrientation: ClipSourceOrientationSchema.optional(),
        fitMode: ClipFitModeSchema.optional(),
      })
      .optional(),
    flags: z
      .object({
        locked: z.boolean().optional(),
        speedActive: z.boolean().optional(),
        transformActive: z.boolean().optional(),
        audioFadesActive: z.boolean().optional(),
        opacityActive: z.boolean().optional(),
        blendModeActive: z.boolean().optional(),
        maskActive: z.boolean().optional(),
      })
      .optional(),
    links: z
      .object({
        linkedGroupId: z.string().trim().min(1).optional(),
        linkedVideoClipId: z.string().trim().min(1).optional(),
        lockToLinkedVideo: z.boolean().optional(),
      })
      .optional(),
    transform: ClipTransformSchema.optional(),
    mask: ClipMaskSchema.optional(),
    transitions: z
      .object({
        in: ClipTransitionFastCatSchema.optional(),
        out: ClipTransitionFastCatSchema.optional(),
      })
      .optional(),
    typeData: z.unknown().optional(),
    roundtrip: TimelineClipRoundtripSchema.optional(),
  })
  .catch({});

export const TimelineTrackFastCatMetaSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    kind: z.enum(['video', 'audio']).optional(),
    video: z
      .object({
        hidden: z.boolean().optional(),
        opacity: z.number().min(0).max(1).optional(),
        blendMode: TimelineBlendModeSchema.optional(),
      })
      .optional(),
    audio: z
      .object({
        muted: z.boolean().optional(),
        solo: z.boolean().optional(),
        gain: z.number().min(0).max(10).optional(),
        balance: z.number().min(-1).max(1).optional(),
      })
      .optional(),
    appearance: z.object({ color: z.string().optional() }).optional(),
    flags: z.object({ locked: z.boolean().optional() }).optional(),
  })
  .catch({});

export const TimelineDocFastCatMetaSchema = z
  .object({
    schema: z.string().optional(),
    version: z.number().optional(),
    docId: z.string().trim().min(1).optional(),
    timebase: z.object({ fps: z.number() }).optional(),
    audio: z
      .object({
        masterGain: z.number().min(0).max(10).optional(),
        masterMuted: z.boolean().optional(),
        masterEffects: z.array(ClipEffectFastCatSchema).optional(),
      })
      .optional(),
    document: z
      .object({
        docId: z.string().trim().min(1).optional(),
        timebase: z.object({ fps: z.number() }).optional(),
        format: z
          .object({
            width: z.number().optional(),
            height: z.number().optional(),
            fps: z.number().optional(),
            resolutionFormat: z.string().optional(),
            orientation: z.enum(['landscape', 'portrait']).optional(),
            aspectRatio: z.string().optional(),
            isCustomResolution: z.boolean().optional(),
            sampleRate: z.number().optional(),
            isAutoSettings: z.boolean().optional(),
            settingsSource: z.enum(['projectDefaults', 'firstClip', 'manual']).optional(),
          })
          .optional(),
        markers: z.array(z.any()).optional(),
      })
      .optional(),
  })
  .catch({});
