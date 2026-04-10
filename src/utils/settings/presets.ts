export interface CustomPreset {
  id: string; // Used as the type in registry
  baseType: string;
  name: string;
  category: 'effect' | 'transition' | 'shape' | 'hud' | 'text';
  effectTarget?: 'video' | 'audio';
  params: Record<string, any>;
  order: number;
}

export interface ProjectSettingsPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  resolutionFormat: string;
  orientation: 'landscape' | 'portrait';
  aspectRatio: string;
  isCustomResolution: boolean;
  sampleRate: number;
}

export interface ExportSettingsPreset {
  id: string;
  name: string;
  format: 'mp4' | 'webm' | 'mkv';
  videoCodec: string;
  bitrateMbps: number;
  excludeAudio: boolean;
  audioCodec: 'aac' | 'opus';
  audioBitrateKbps: number;
  bitrateMode: 'constant' | 'variable';
  keyframeIntervalSec: number;
  exportAlpha: boolean;
}

export interface UserProjectPresetsSettings {
  selectedPresetId: string;
  lastUsedPresetId: string;
  items: ProjectSettingsPreset[];
}

export interface UserExportPresetsSettings {
  selectedPresetId: string;
  items: ExportSettingsPreset[];
}

export const DEFAULT_PROJECT_PRESET_ID = 'fhd-25-desktop';
export const DEFAULT_EXPORT_PRESET_ID = 'optimal';

export function createDefaultProjectPresets(): UserProjectPresetsSettings {
  const items: ProjectSettingsPreset[] = [
    {
      id: 'fhd-25-desktop',
      name: '25 FPS FullHD Desktop',
      width: 1920,
      height: 1080,
      fps: 25,
      resolutionFormat: '1080p',
      orientation: 'landscape',
      aspectRatio: '16:9',
      isCustomResolution: false,
      sampleRate: 48000,
    },
    {
      id: 'fhd-25-mobile',
      name: '25 FPS FullHD Mobile',
      width: 1080,
      height: 1920,
      fps: 25,
      resolutionFormat: '1080p',
      orientation: 'portrait',
      aspectRatio: '16:9',
      isCustomResolution: false,
      sampleRate: 48000,
    },
    {
      id: 'fhd-30-desktop',
      name: '30 FPS FullHD Desktop',
      width: 1920,
      height: 1080,
      fps: 30,
      resolutionFormat: '1080p',
      orientation: 'landscape',
      aspectRatio: '16:9',
      isCustomResolution: false,
      sampleRate: 48000,
    },
    {
      id: 'fhd-30-mobile',
      name: '30 FPS FullHD Mobile',
      width: 1080,
      height: 1920,
      fps: 30,
      resolutionFormat: '1080p',
      orientation: 'portrait',
      aspectRatio: '16:9',
      isCustomResolution: false,
      sampleRate: 48000,
    },
  ];

  return {
    selectedPresetId: DEFAULT_PROJECT_PRESET_ID,
    lastUsedPresetId: DEFAULT_PROJECT_PRESET_ID,
    items,
  };
}

export function createDefaultExportPresets(): UserExportPresetsSettings {
  const items: ExportSettingsPreset[] = [
    {
      id: 'optimal',
      name: 'Optimal',
      format: 'mkv',
      videoCodec: 'av01.0.05M.08',
      bitrateMbps: 5,
      excludeAudio: false,
      audioCodec: 'opus',
      audioBitrateKbps: 128,
      bitrateMode: 'variable',
      keyframeIntervalSec: 2,
      exportAlpha: false,
    },
    {
      id: 'social',
      name: 'Social Media',
      format: 'mp4',
      videoCodec: 'avc1.640032',
      bitrateMbps: 8,
      excludeAudio: false,
      audioCodec: 'aac',
      audioBitrateKbps: 128,
      bitrateMode: 'variable',
      keyframeIntervalSec: 2,
      exportAlpha: false,
    },
    {
      id: 'high',
      name: 'High Quality',
      format: 'mkv',
      videoCodec: 'av01.0.05M.08',
      bitrateMbps: 20,
      excludeAudio: false,
      audioCodec: 'opus',
      audioBitrateKbps: 192,
      bitrateMode: 'variable',
      keyframeIntervalSec: 2,
      exportAlpha: false,
    },
    {
      id: 'lossless',
      name: 'Visually Lossless',
      format: 'mkv',
      videoCodec: 'av01.0.05M.08',
      bitrateMbps: 50,
      excludeAudio: false,
      audioCodec: 'opus',
      audioBitrateKbps: 320,
      bitrateMode: 'constant',
      keyframeIntervalSec: 1,
      exportAlpha: false,
    },
  ];

  return {
    selectedPresetId: DEFAULT_EXPORT_PRESET_ID,
    items,
  };
}

export function resolveProjectPreset(
  settings?: Partial<UserProjectPresetsSettings> | null,
): ProjectSettingsPreset {
  const fallback = createDefaultProjectPresets();
  const items = Array.isArray(settings?.items) ? settings.items : fallback.items;
  const selectedPresetId =
    typeof settings?.selectedPresetId === 'string'
      ? settings.selectedPresetId
      : fallback.selectedPresetId;

  return items.find((preset) => preset.id === selectedPresetId) ?? items[0] ?? fallback.items[0]!;
}

export function resolveLastUsedProjectPreset(
  settings?: Partial<UserProjectPresetsSettings> | null,
): ProjectSettingsPreset {
  const fallback = createDefaultProjectPresets();
  const items = Array.isArray(settings?.items) ? settings.items : fallback.items;
  const lastUsedPresetId =
    typeof settings?.lastUsedPresetId === 'string' ? settings.lastUsedPresetId : null;
  const selectedPresetId =
    typeof settings?.selectedPresetId === 'string'
      ? settings.selectedPresetId
      : fallback.selectedPresetId;

  return (
    items.find((preset) => preset.id === lastUsedPresetId) ??
    items.find((preset) => preset.id === selectedPresetId) ??
    items[0] ??
    fallback.items[0]!
  );
}

export function resolveExportPreset(
  settings?: Partial<UserExportPresetsSettings> | null,
): ExportSettingsPreset {
  const fallback = createDefaultExportPresets();
  const items = Array.isArray(settings?.items) ? settings.items : fallback.items;
  const selectedPresetId =
    typeof settings?.selectedPresetId === 'string'
      ? settings.selectedPresetId
      : fallback.selectedPresetId;

  return items.find((preset) => preset.id === selectedPresetId) ?? items[0] ?? fallback.items[0]!;
}

export function createProjectPresetId(): string {
  return `project-${Math.random().toString(36).slice(2, 10)}`;
}

export function createExportPresetId(): string {
  return `export-${Math.random().toString(36).slice(2, 10)}`;
}
