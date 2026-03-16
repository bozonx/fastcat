import type { FastCatUserSettings } from './defaults';
import { createDefaultUserSettings } from './helpers';
import { normalizeAppSettings, normalizeWorkspaceSettings } from './normalizers/app';
import { normalizeHotkeys } from './normalizers/hotkeys';
import { normalizeUserPresets } from './normalizers/presets';
import {
  normalizeDeleteWithoutConfirmation,
  normalizeIntegrationsSettings,
  normalizeMouseSettings,
  normalizeOpenLastProjectOnStart,
  normalizeOptimizationSettings,
  normalizeStopFramesSettings,
  normalizeTimelineSettings,
  normalizeVideoSettings,
} from './normalizers/user-domains';
import { normalizeLocale } from './normalizers/shared';

export function normalizeUserSettings(raw: unknown): FastCatUserSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultUserSettings();
  }

  const input = raw as Record<string, unknown>;
  const presets = normalizeUserPresets(input);
  const projectInput = presets.projectInput;
  const hotkeys = normalizeHotkeys(input.hotkeys);

  return {
    locale: normalizeLocale(input),
    openLastProjectOnStart: normalizeOpenLastProjectOnStart(input),
    deleteWithoutConfirmation: normalizeDeleteWithoutConfirmation(input),
    timeline: normalizeTimelineSettings(input),
    stopFrames: normalizeStopFramesSettings(input),
    hotkeys,
    optimization: normalizeOptimizationSettings(input),
    projectPresets: presets.projectPresets,
    exportPresets: presets.exportPresets,
    projectDefaults: {
      width: Number(presets.selectedProjectPreset.width) || 1920,
      height: Number(presets.selectedProjectPreset.height) || 1080,
      fps: Number(presets.selectedProjectPreset.fps) || 60,
      resolutionFormat: String(presets.selectedProjectPreset.resolutionFormat || '1080p'),
      orientation: ['landscape', 'portrait'].includes(
        String(presets.selectedProjectPreset.orientation),
      )
        ? (presets.selectedProjectPreset.orientation as 'landscape' | 'portrait')
        : 'landscape',
      aspectRatio: String(presets.selectedProjectPreset.aspectRatio || '16:9'),
      isCustomResolution: Boolean(presets.selectedProjectPreset.isCustomResolution),
      sampleRate: Number(presets.selectedProjectPreset.sampleRate) || 48000,
      audioDeclickDurationUs:
        Number.isFinite(Number(projectInput.audioDeclickDurationUs)) &&
        Number(projectInput.audioDeclickDurationUs) >= 0
          ? Number(projectInput.audioDeclickDurationUs)
          : presets.fallbackAudioDeclickDurationUs,
      defaultAudioFadeCurve:
        projectInput.defaultAudioFadeCurve === 'linear' ||
        projectInput.defaultAudioFadeCurve === 'logarithmic'
          ? projectInput.defaultAudioFadeCurve
          : presets.fallbackDefaultAudioFadeCurve,
      audioScrubbingEnabled:
        typeof projectInput.audioScrubbingEnabled === 'boolean'
          ? projectInput.audioScrubbingEnabled
          : true,
    },
    integrations: normalizeIntegrationsSettings(input),
    video: normalizeVideoSettings(input),
    mouse: normalizeMouseSettings(input.mouse),
  };
}

export { normalizeAppSettings, normalizeWorkspaceSettings };
