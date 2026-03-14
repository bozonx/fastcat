import { DEFAULT_USER_SETTINGS } from '../defaults';
import { getResolutionPreset } from '../helpers';
import {
  createDefaultExportPresets,
  createDefaultProjectPresets,
  resolveExportPreset,
  resolveProjectPreset,
  type ExportSettingsPreset,
  type ProjectSettingsPreset,
} from '../presets';
import { asRecord } from './shared';

export function getProjectInput(raw: Record<string, unknown>): Record<string, unknown> {
  const legacyExportInput = raw.exportDefaults ?? raw.export ?? null;
  return asRecord(raw.projectDefaults ?? legacyExportInput ?? {});
}

export function getExportEncodingInput(raw: Record<string, unknown>): Record<string, unknown> {
  const exportDefaults = asRecord(raw.exportDefaults);
  const legacyExport = asRecord(raw.export);
  return asRecord(exportDefaults.encoding ?? legacyExport.encoding ?? {});
}

export function normalizeProjectPresetItem(
  raw: unknown,
  fallback: ProjectSettingsPreset,
): ProjectSettingsPreset {
  const input = asRecord(raw);
  const width = Number(input.width);
  const height = Number(input.height);
  const fps = Number(input.fps);
  const sampleRateRaw = Number(input.sampleRate);
  const normalizedWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : fallback.width;
  const normalizedHeight =
    Number.isFinite(height) && height > 0 ? Math.round(height) : fallback.height;
  const preset = getResolutionPreset(normalizedWidth, normalizedHeight);
  const isWidthHeightCustom =
    normalizedWidth !== fallback.width || normalizedHeight !== fallback.height;

  return {
    id: typeof input.id === 'string' && input.id.trim().length > 0 ? input.id.trim() : fallback.id,
    name:
      typeof input.name === 'string' && input.name.trim().length > 0
        ? input.name.trim()
        : fallback.name,
    width: normalizedWidth,
    height: normalizedHeight,
    fps:
      Number.isFinite(fps) && fps > 0 ? Math.round(Math.min(240, Math.max(1, fps))) : fallback.fps,
    resolutionFormat:
      typeof input.resolutionFormat === 'string' && input.resolutionFormat && !isWidthHeightCustom
        ? input.resolutionFormat
        : preset.resolutionFormat,
    orientation:
      (input.orientation === 'portrait' || input.orientation === 'landscape') &&
      !isWidthHeightCustom
        ? input.orientation
        : (preset.orientation as 'landscape' | 'portrait'),
    aspectRatio:
      typeof input.aspectRatio === 'string' && input.aspectRatio && !isWidthHeightCustom
        ? input.aspectRatio
        : preset.aspectRatio,
    isCustomResolution:
      input.isCustomResolution !== undefined && !isWidthHeightCustom
        ? Boolean(input.isCustomResolution)
        : preset.isCustomResolution,
    sampleRate:
      Number.isFinite(sampleRateRaw) && sampleRateRaw > 0
        ? Math.round(Math.min(192000, Math.max(8000, sampleRateRaw)))
        : fallback.sampleRate,
  };
}

export function normalizeExportPresetItem(
  raw: unknown,
  fallback: ExportSettingsPreset,
): ExportSettingsPreset {
  const input = asRecord(raw);
  const bitrateMbps = Number(input.bitrateMbps);
  const audioBitrateKbps = Number(input.audioBitrateKbps);
  const keyframeIntervalSec = Number(input.keyframeIntervalSec);

  return {
    id: typeof input.id === 'string' && input.id.trim().length > 0 ? input.id.trim() : fallback.id,
    name:
      typeof input.name === 'string' && input.name.trim().length > 0
        ? input.name.trim()
        : fallback.name,
    format: input.format === 'webm' || input.format === 'mkv' ? input.format : 'mp4',
    videoCodec:
      typeof input.videoCodec === 'string' && input.videoCodec.trim().length > 0
        ? input.videoCodec
        : fallback.videoCodec,
    bitrateMbps:
      Number.isFinite(bitrateMbps) && bitrateMbps > 0
        ? Math.min(200, Math.max(0.2, bitrateMbps))
        : fallback.bitrateMbps,
    excludeAudio: Boolean(input.excludeAudio),
    audioCodec: input.audioCodec === 'opus' ? 'opus' : 'aac',
    audioBitrateKbps:
      Number.isFinite(audioBitrateKbps) && audioBitrateKbps > 0
        ? Math.round(Math.min(1024, Math.max(32, audioBitrateKbps)))
        : fallback.audioBitrateKbps,
    bitrateMode: input.bitrateMode === 'constant' ? 'constant' : 'variable',
    keyframeIntervalSec:
      Number.isFinite(keyframeIntervalSec) && keyframeIntervalSec > 0
        ? Math.round(Math.min(60, Math.max(1, keyframeIntervalSec)))
        : fallback.keyframeIntervalSec,
    exportAlpha: Boolean(input.exportAlpha),
  };
}

export function normalizeUserPresets(input: Record<string, unknown>) {
  const projectInput = getProjectInput(input);
  const exportEncodingInput = getExportEncodingInput(input);
  const defaultProjectPresets = createDefaultProjectPresets();
  const defaultExportPresets = createDefaultExportPresets();

  const legacyProjectPreset = normalizeProjectPresetItem(
    {
      id: defaultProjectPresets.selectedPresetId,
      name:
        defaultProjectPresets.items.find((item) => item.id === defaultProjectPresets.selectedPresetId)
          ?.name ?? 'Project Preset',
      ...projectInput,
    },
    defaultProjectPresets.items[0]!,
  );
  const legacyExportPreset = normalizeExportPresetItem(
    {
      id: defaultExportPresets.selectedPresetId,
      name:
        defaultExportPresets.items.find((item) => item.id === defaultExportPresets.selectedPresetId)
          ?.name ?? 'Export Preset',
      ...exportEncodingInput,
    },
    defaultExportPresets.items[0]!,
  );

  const rawProjectPresets = asRecord(input.projectPresets);
  const rawProjectPresetItems = Array.isArray(rawProjectPresets.items) ? rawProjectPresets.items : null;
  const projectPresetFallbacks = defaultProjectPresets.items;
  const normalizedProjectPresetItems = rawProjectPresetItems?.map((item, index) =>
    normalizeProjectPresetItem(item, projectPresetFallbacks[index] ?? projectPresetFallbacks[0]!),
  ) ?? [legacyProjectPreset, ...projectPresetFallbacks.slice(1).map((preset) => ({ ...preset }))];

  const rawExportPresets = asRecord(input.exportPresets);
  const rawExportPresetItems = Array.isArray(rawExportPresets.items) ? rawExportPresets.items : null;
  const exportPresetFallbacks = defaultExportPresets.items;
  const normalizedExportPresetItems = rawExportPresetItems?.map((item, index) =>
    normalizeExportPresetItem(item, exportPresetFallbacks[index] ?? exportPresetFallbacks[0]!),
  ) ?? [legacyExportPreset, ...exportPresetFallbacks.slice(1).map((preset) => ({ ...preset }))];

  const projectPresets = {
    selectedPresetId:
      typeof rawProjectPresets.selectedPresetId === 'string' &&
      normalizedProjectPresetItems.some((preset) => preset.id === rawProjectPresets.selectedPresetId)
        ? rawProjectPresets.selectedPresetId
        : normalizedProjectPresetItems[0]!.id,
    lastUsedPresetId:
      typeof rawProjectPresets.lastUsedPresetId === 'string' &&
      normalizedProjectPresetItems.some((preset) => preset.id === rawProjectPresets.lastUsedPresetId)
        ? rawProjectPresets.lastUsedPresetId
        : normalizedProjectPresetItems[0]!.id,
    items: normalizedProjectPresetItems,
  };

  const exportPresets = {
    selectedPresetId:
      typeof rawExportPresets.selectedPresetId === 'string' &&
      normalizedExportPresetItems.some((preset) => preset.id === rawExportPresets.selectedPresetId)
        ? rawExportPresets.selectedPresetId
        : normalizedExportPresetItems[0]!.id,
    items: normalizedExportPresetItems,
  };

  const selectedProjectPreset = resolveProjectPreset(projectPresets);
  const selectedExportPreset = resolveExportPreset(exportPresets);

  return {
    projectInput,
    exportEncodingInput,
    projectPresets,
    exportPresets,
    selectedProjectPreset,
    selectedExportPreset,
    fallbackAudioDeclickDurationUs: DEFAULT_USER_SETTINGS.projectDefaults.audioDeclickDurationUs,
    fallbackDefaultAudioFadeCurve: DEFAULT_USER_SETTINGS.projectDefaults.defaultAudioFadeCurve,
  };
}
