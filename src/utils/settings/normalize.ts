import type { FastCatUserSettings } from './defaults';
import { createDefaultUserSettings } from './helpers';
import { normalizeAppSettings, normalizeWorkspaceSettings } from './normalizers/app';
import { normalizeHotkeys } from './normalizers/hotkeys';
import { normalizeUserPresets } from './normalizers/presets';
import {
  normalizeAudioEngineSettings,
  normalizeAudioPluginSettings,
  normalizeDeleteWithoutConfirmation,
  normalizeExperimentalFeatures,
  normalizeIntegrationsSettings,
  normalizeMouseSettings,
  normalizeOpenLastProjectOnStart,
  normalizeOptimizationSettings,
  normalizeStopFramesSettings,
  normalizeTimelineSettings,
  normalizeProjectDefaults,
  normalizeHistorySettings,
  normalizeBackupSettings,
  normalizeAutosaveSettings,
  normalizePresetsSettings,
  normalizeUiSettings,
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
    ui: normalizeUiSettings(input),
    timeline: normalizeTimelineSettings(input),
    stopFrames: normalizeStopFramesSettings(input),
    hotkeys,
    optimization: normalizeOptimizationSettings(input),
    projectPresets: presets.projectPresets,
    exportPresets: presets.exportPresets,
    projectDefaults: normalizeProjectDefaults({
      width: presets.selectedProjectPreset.width,
      height: presets.selectedProjectPreset.height,
      fps: presets.selectedProjectPreset.fps,
      resolutionFormat: presets.selectedProjectPreset.resolutionFormat,
      orientation: presets.selectedProjectPreset.orientation,
      aspectRatio: presets.selectedProjectPreset.aspectRatio,
      isCustomResolution: presets.selectedProjectPreset.isCustomResolution,
      sampleRate: presets.selectedProjectPreset.sampleRate,
      audioDeclickDurationUs:
        projectInput.audioDeclickDurationUs ?? presets.fallbackAudioDeclickDurationUs,
      defaultAudioFadeCurve:
        projectInput.defaultAudioFadeCurve ?? presets.fallbackDefaultAudioFadeCurve,
      audioScrubbingEnabled: projectInput.audioScrubbingEnabled,
    }),
    integrations: normalizeIntegrationsSettings(input),
    mouse: normalizeMouseSettings(input.mouse),
    history: normalizeHistorySettings(input),
    backup: normalizeBackupSettings(input),
    autosave: normalizeAutosaveSettings(input),
    experimentalFeatures: normalizeExperimentalFeatures(input),
    presets: normalizePresetsSettings(input),
    audioEngine: normalizeAudioEngineSettings(input),
    audioPlugins: normalizeAudioPluginSettings(input),
  };
}

export { normalizeAppSettings, normalizeWorkspaceSettings };
