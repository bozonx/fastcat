import { z } from 'zod';
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

export function getProjectInput(raw: Record<string, unknown>): Record<string, unknown> {
  const legacyExportInput = raw.exportDefaults ?? raw.export ?? null;
  const projectDefaults = raw.projectDefaults ?? legacyExportInput ?? {};
  return typeof projectDefaults === 'object' && projectDefaults !== null ? (projectDefaults as Record<string, unknown>) : {};
}

export function getExportEncodingInput(raw: Record<string, unknown>): Record<string, unknown> {
  const exportDefaults = raw.exportDefaults && typeof raw.exportDefaults === 'object' ? raw.exportDefaults : {};
  const legacyExport = raw.export && typeof raw.export === 'object' ? raw.export : {};
  const enc = (exportDefaults as any).encoding ?? (legacyExport as any).encoding ?? {};
  return typeof enc === 'object' && enc !== null ? (enc as Record<string, unknown>) : {};
}

export function normalizeProjectPresetItem(
  raw: unknown,
  fallback: ProjectSettingsPreset,
): ProjectSettingsPreset {
  const schema = z.object({
    id: z.string().trim().min(1).catch(fallback.id),
    name: z.string().trim().min(1).catch(fallback.name),
    width: z.coerce.number().int().min(1).catch(fallback.width),
    height: z.coerce.number().int().min(1).catch(fallback.height),
    fps: z.coerce.number().min(1).max(240).catch(fallback.fps),
    resolutionFormat: z.string().catch(''),
    orientation: z.enum(['landscape', 'portrait']).catch('landscape' as any),
    aspectRatio: z.string().catch(''),
    isCustomResolution: z.coerce.boolean().catch(false),
    sampleRate: z.coerce.number().min(8000).max(192000).catch(fallback.sampleRate),
  }).transform((val) => {
    const isWidthHeightCustom = val.width !== fallback.width || val.height !== fallback.height;
    if (!isWidthHeightCustom) {
      return {
        ...val,
        resolutionFormat: val.resolutionFormat || fallback.resolutionFormat,
        orientation: (val.orientation || fallback.orientation) as 'landscape' | 'portrait',
        aspectRatio: val.aspectRatio || fallback.aspectRatio,
        isCustomResolution: val.isCustomResolution ?? fallback.isCustomResolution,
      };
    }
    const preset = getResolutionPreset(val.width, val.height);
    return {
      ...val,
      resolutionFormat: preset.resolutionFormat,
      orientation: preset.orientation as 'landscape' | 'portrait',
      aspectRatio: preset.aspectRatio,
      isCustomResolution: preset.isCustomResolution,
    };
  }).catch(fallback);

  return schema.parse(raw ?? {});
}

export function normalizeExportPresetItem(
  raw: unknown,
  fallback: ExportSettingsPreset,
): ExportSettingsPreset {
  const schema = z.object({
    id: z.string().trim().min(1).catch(fallback.id),
    name: z.string().trim().min(1).catch(fallback.name),
    format: z.enum(['mp4', 'webm', 'mkv']).catch(fallback.format as any),
    videoCodec: z.string().trim().min(1).catch(fallback.videoCodec),
    bitrateMbps: z.coerce.number().min(0.2).max(200).catch(fallback.bitrateMbps),
    excludeAudio: z.boolean().catch(fallback.excludeAudio),
    audioCodec: z.enum(['aac', 'opus']).catch(fallback.audioCodec as any),
    audioBitrateKbps: z.coerce.number().min(32).max(1024).catch(fallback.audioBitrateKbps),
    bitrateMode: z.enum(['constant', 'variable']).catch(fallback.bitrateMode as any),
    keyframeIntervalSec: z.coerce.number().min(1).max(60).catch(fallback.keyframeIntervalSec),
    exportAlpha: z.boolean().catch(fallback.exportAlpha),
  }).catch(fallback);

  return schema.parse(raw ?? {});
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

  const rawProjectPresets = (input.projectPresets && typeof input.projectPresets === 'object') ? (input.projectPresets as any) : {};
  const rawProjectPresetItems = Array.isArray(rawProjectPresets.items) ? rawProjectPresets.items : null;
  const projectPresetFallbacks = defaultProjectPresets.items;
  const normalizedProjectPresetItems = rawProjectPresetItems?.map((item: any, index: number) =>
    normalizeProjectPresetItem(item, projectPresetFallbacks[index] ?? projectPresetFallbacks[0]!),
  ) ?? [legacyProjectPreset, ...projectPresetFallbacks.slice(1).map((preset) => ({ ...preset }))];

  const rawExportPresets = (input.exportPresets && typeof input.exportPresets === 'object') ? (input.exportPresets as any) : {};
  const rawExportPresetItems = Array.isArray(rawExportPresets.items) ? rawExportPresets.items : null;
  const exportPresetFallbacks = defaultExportPresets.items;
  const normalizedExportPresetItems = rawExportPresetItems?.map((item: any, index: number) =>
    normalizeExportPresetItem(item, exportPresetFallbacks[index] ?? exportPresetFallbacks[0]!),
  ) ?? [legacyExportPreset, ...exportPresetFallbacks.slice(1).map((preset) => ({ ...preset }))];

  const projectPresets = {
    selectedPresetId:
      typeof rawProjectPresets.selectedPresetId === 'string' &&
      normalizedProjectPresetItems.some((preset: any) => preset.id === rawProjectPresets.selectedPresetId)
        ? rawProjectPresets.selectedPresetId
        : normalizedProjectPresetItems[0]!.id,
    lastUsedPresetId:
      typeof rawProjectPresets.lastUsedPresetId === 'string' &&
      normalizedProjectPresetItems.some((preset: any) => preset.id === rawProjectPresets.lastUsedPresetId)
        ? rawProjectPresets.lastUsedPresetId
        : normalizedProjectPresetItems[0]!.id,
    items: normalizedProjectPresetItems,
  };

  const exportPresets = {
    selectedPresetId:
      typeof rawExportPresets.selectedPresetId === 'string' &&
      normalizedExportPresetItems.some((preset: any) => preset.id === rawExportPresets.selectedPresetId)
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
