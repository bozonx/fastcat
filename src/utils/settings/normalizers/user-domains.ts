import { z } from 'zod';
import { DEFAULT_USER_SETTINGS, type FastCatUserSettings } from '../defaults';
import {
  CLICK_ACTIONS,
  DRAG_ACTIONS,
  MONITOR_CLICK_ACTIONS,
  MONITOR_DRAG_ACTIONS,
  MONITOR_WHEEL_ACTIONS,
  MOUSE_HORIZONTAL_MOVEMENT_ACTIONS,
  RULER_WHEEL_ACTIONS,
  TIMELINE_WHEEL_ACTIONS,
  TRACK_HEADERS_WHEEL_ACTIONS,
} from '~/utils/mouse';
import { normalizeTokenValue, normalizeUrlValue } from './shared';

export function normalizeOpenLastProjectOnStart(raw: unknown): boolean {
  return z.boolean().catch(DEFAULT_USER_SETTINGS.openLastProjectOnStart).parse(
    (raw as any)?.openBehavior === 'show_project_picker' ? false : (raw as any)?.openLastProjectOnStart
  );
}

export function normalizeDeleteWithoutConfirmation(raw: unknown): boolean {
  return z.boolean().catch(DEFAULT_USER_SETTINGS.deleteWithoutConfirmation).parse((raw as any)?.deleteWithoutConfirmation);
}

export function normalizeTimelineSettings(
  raw: unknown,
): FastCatUserSettings['timeline'] {
  const legacySnap = (raw as any)?.snapThresholdPx;
  
  const schema = z.object({
    snapThresholdPx: z.coerce.number().min(1).catch(DEFAULT_USER_SETTINGS.timeline.snapThresholdPx),
    defaultTransitionDurationUs: z.coerce.number().min(0).catch(DEFAULT_USER_SETTINGS.timeline.defaultTransitionDurationUs),
    defaultStaticClipDurationUs: z.coerce.number().min(0).catch(DEFAULT_USER_SETTINGS.timeline.defaultStaticClipDurationUs),
    snapping: z.object({
      timelineEdges: z.boolean().catch(DEFAULT_USER_SETTINGS.timeline.snapping.timelineEdges),
      clips: z.boolean().catch(DEFAULT_USER_SETTINGS.timeline.snapping.clips),
      markers: z.boolean().catch(DEFAULT_USER_SETTINGS.timeline.snapping.markers),
      selection: z.boolean().catch(DEFAULT_USER_SETTINGS.timeline.snapping.selection),
      playhead: z.boolean().catch(DEFAULT_USER_SETTINGS.timeline.snapping.playhead),
    }).catch(DEFAULT_USER_SETTINGS.timeline.snapping),
  }).catch(DEFAULT_USER_SETTINGS.timeline);
  
  const tl = schema.parse((raw as any)?.timeline);
  if (legacySnap !== undefined && (raw as any)?.timeline?.snapThresholdPx === undefined) {
      const parsedLegacy = z.coerce.number().min(1).safeParse(legacySnap);
      if (parsedLegacy.success) {
          tl.snapThresholdPx = parsedLegacy.data;
      }
  }
  return tl;
}

export function normalizeStopFramesSettings(
  raw: unknown,
): FastCatUserSettings['stopFrames'] {
  const qp = (raw as any)?.stopFrames?.qualityPercent ?? (raw as any)?.stopFrameQualityPercent ?? (raw as any)?.stopFramesQuality;
  return z.object({
    qualityPercent: z.coerce.number().min(1).max(100).catch(DEFAULT_USER_SETTINGS.stopFrames.qualityPercent),
  }).catch(DEFAULT_USER_SETTINGS.stopFrames).parse({ qualityPercent: qp });
}

export function normalizeOptimizationSettings(
  raw: unknown,
): FastCatUserSettings['optimization'] {
  const opt = (raw as any)?.optimization ?? {};
  
  // Custom parsing step for proxyResolution string mapping
  let proxyMaxPixels = opt.proxyMaxPixels;
  if (proxyMaxPixels === undefined && opt.proxyResolution) {
      if (opt.proxyResolution === '360p') proxyMaxPixels = 400_000;
      else if (opt.proxyResolution === '480p') proxyMaxPixels = 700_000;
      else if (opt.proxyResolution === '720p') proxyMaxPixels = 1_500_000;
      else if (opt.proxyResolution === '1080p') proxyMaxPixels = 3_000_000;
  }

  const schema = z.object({
    proxyMaxPixels: z.coerce.number().min(100_000).max(10_000_000).catch(DEFAULT_USER_SETTINGS.optimization.proxyMaxPixels),
    proxyVideoBitrateMbps: z.coerce.number().min(0.1).max(50).catch(DEFAULT_USER_SETTINGS.optimization.proxyVideoBitrateMbps),
    proxyAudioBitrateKbps: z.coerce.number().min(32).max(512).catch(DEFAULT_USER_SETTINGS.optimization.proxyAudioBitrateKbps),
    proxyVideoCodec: z.enum(['h264', 'av1']).catch('h264'), // Note: legacy is checked against 'av1', else 'h264'
    proxyCopyOpusAudio: z.boolean().catch(DEFAULT_USER_SETTINGS.optimization.proxyCopyOpusAudio),
    autoCreateProxies: z.boolean().catch(DEFAULT_USER_SETTINGS.optimization.autoCreateProxies),
    mediaTaskConcurrency: z.coerce.number().min(1).max(16).catch(DEFAULT_USER_SETTINGS.optimization.mediaTaskConcurrency),
    videoFrameCacheMb: z.coerce.number().min(0).max(4096).catch(DEFAULT_USER_SETTINGS.optimization.videoFrameCacheMb),
  }).catch(DEFAULT_USER_SETTINGS.optimization);
  
  return schema.parse({
     ...opt,
     proxyMaxPixels,
     mediaTaskConcurrency: opt.mediaTaskConcurrency ?? opt.proxyConcurrency,
  });
}

export function normalizeIntegrationsSettings(
  raw: unknown,
): FastCatUserSettings['integrations'] {
  const schema = z.object({
    fastcatPublicador: z.object({
       enabled: z.coerce.boolean().catch(false),
       bearerToken: z.string().transform(normalizeTokenValue).catch(''),
    }).catch(DEFAULT_USER_SETTINGS.integrations.fastcatPublicador),
    manualFilesApi: z.object({
       enabled: z.coerce.boolean().catch(false),
       baseUrl: z.string().transform(normalizeUrlValue).catch(''),
       bearerToken: z.string().transform(normalizeTokenValue).catch(''),
       overrideFastCat: z.coerce.boolean().catch(false),
    }).catch(DEFAULT_USER_SETTINGS.integrations.manualFilesApi),
    manualSttApi: z.object({
       enabled: z.coerce.boolean().catch(false),
       baseUrl: z.string().transform(normalizeUrlValue).catch(''),
       bearerToken: z.string().transform(normalizeTokenValue).catch(''),
       overrideFastCat: z.coerce.boolean().catch(false),
    }).catch(DEFAULT_USER_SETTINGS.integrations.manualSttApi),
    stt: z.object({
       provider: z.string().trim().catch(DEFAULT_USER_SETTINGS.integrations.stt.provider),
       models: z.array(z.string().trim()).catch([...DEFAULT_USER_SETTINGS.integrations.stt.models]),
       restorePunctuation: z.boolean().catch(DEFAULT_USER_SETTINGS.integrations.stt.restorePunctuation),
       formatText: z.boolean().catch(DEFAULT_USER_SETTINGS.integrations.stt.formatText),
       includeWords: z.boolean().catch(DEFAULT_USER_SETTINGS.integrations.stt.includeWords),
    }).catch(DEFAULT_USER_SETTINGS.integrations.stt),
  }).catch(DEFAULT_USER_SETTINGS.integrations);

  return schema.parse((raw as any)?.integrations ?? {});
}

export function normalizeVideoSettings(
  raw: unknown,
): FastCatUserSettings['video'] {
  return z.object({
    enableFfmpeg: z.boolean().catch(DEFAULT_USER_SETTINGS.video.enableFfmpeg),
  }).catch(DEFAULT_USER_SETTINGS.video).parse((raw as any)?.video ?? {});
}

export function normalizeMouseSettings(raw: unknown): FastCatUserSettings['mouse'] {
  const rWheelEnum = z.enum(RULER_WHEEL_ACTIONS as any);
  const clickEnum = z.enum(CLICK_ACTIONS as any);
  const dragEnum = z.enum(DRAG_ACTIONS as any);
  const horizEnum = z.enum(MOUSE_HORIZONTAL_MOVEMENT_ACTIONS as any);
  const tWheelEnum = z.enum(TIMELINE_WHEEL_ACTIONS as any);
  const thWheelEnum = z.enum(TRACK_HEADERS_WHEEL_ACTIONS as any);
  const mWheelEnum = z.enum(MONITOR_WHEEL_ACTIONS as any);
  const mClickEnum = z.enum(MONITOR_CLICK_ACTIONS as any);
  const mDragEnum = z.enum(MONITOR_DRAG_ACTIONS as any);

  const rulerWheelFallbacks = {
    wheel: DEFAULT_USER_SETTINGS.mouse.timeline.wheel,
    wheelSecondary: DEFAULT_USER_SETTINGS.mouse.timeline.wheel,
    wheelSecondaryShift: DEFAULT_USER_SETTINGS.mouse.ruler.wheel,
  };

  const schema = z.object({
    ruler: z.object({
      wheel: rWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.wheel),
      wheelShift: rWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.wheelShift),
      wheelSecondary: rWheelEnum.catch(rulerWheelFallbacks.wheelSecondary),
      wheelSecondaryShift: rWheelEnum.catch(rulerWheelFallbacks.wheelSecondaryShift),
      click: clickEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.click as any),
      middleClick: clickEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.middleClick as any),
      doubleClick: clickEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.doubleClick as any),
      shiftClick: clickEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.shiftClick as any),
      drag: dragEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.drag as any),
      middleDrag: dragEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.middleDrag as any),
      dragShift: dragEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.dragShift as any),
      horizontalMovement: horizEnum.catch(DEFAULT_USER_SETTINGS.mouse.ruler.horizontalMovement as any),
    }).catch(DEFAULT_USER_SETTINGS.mouse.ruler),
    
    timeline: z.object({
      wheel: tWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.wheel as any),
      wheelShift: tWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.wheelShift as any),
      wheelSecondary: tWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.wheelSecondary as any),
      wheelSecondaryShift: tWheelEnum.catch('none'),
      middleClick: clickEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.middleDrag as any), // Legacy middleClick fallback was middleDrag? Well, kept standard
      middleDrag: dragEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.middleDrag as any),
      horizontalMovement: horizEnum.catch(DEFAULT_USER_SETTINGS.mouse.timeline.horizontalMovement as any),
      clipDragShift: z.enum(['pseudo_overlap', 'free_mode', 'copy', 'toggle_snap', 'toggle_clip_move_mode', 'none']).catch(DEFAULT_USER_SETTINGS.mouse.timeline.clipDragShift),
      clipDragCtrl: z.enum(['pseudo_overlap', 'free_mode', 'copy', 'toggle_snap', 'toggle_clip_move_mode', 'none']).catch(DEFAULT_USER_SETTINGS.mouse.timeline.clipDragCtrl),
      clipDragRight: z.enum(['pseudo_overlap', 'free_mode', 'copy', 'toggle_snap', 'toggle_clip_move_mode', 'none']).catch(DEFAULT_USER_SETTINGS.mouse.timeline.clipDragRight),
    }).catch(DEFAULT_USER_SETTINGS.mouse.timeline),
    
    trackHeaders: z.object({
      wheel: thWheelEnum.catch('seek_frame'),
      wheelShift: thWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.trackHeaders.wheelShift as any),
      wheelSecondary: thWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.trackHeaders.wheelSecondary as any),
      wheelSecondaryShift: thWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.trackHeaders.wheelSecondaryShift as any),
    }).catch(DEFAULT_USER_SETTINGS.mouse.trackHeaders),
    
    monitor: z.object({
      wheel: mWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.monitor.wheel as any),
      wheelShift: mWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.monitor.wheelShift as any),
      wheelSecondary: mWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.monitor.wheelSecondary as any),
      wheelSecondaryShift: mWheelEnum.catch(DEFAULT_USER_SETTINGS.mouse.monitor.wheelSecondaryShift as any),
      middleClick: mClickEnum.catch(DEFAULT_USER_SETTINGS.mouse.monitor.middleClick as any),
      middleDrag: mDragEnum.catch(DEFAULT_USER_SETTINGS.mouse.monitor.middleDrag as any),
    }).catch(DEFAULT_USER_SETTINGS.mouse.monitor),
  }).catch(DEFAULT_USER_SETTINGS.mouse);

  return schema.parse((raw as any)?.mouse ?? {});
}
