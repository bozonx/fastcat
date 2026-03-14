import type { FastCatAppSettings, FastCatWorkspaceSettings } from '../defaults';
import { createDefaultAppSettings } from '../helpers';
import { asRecord, normalizeStoragePathValue } from './shared';

export function normalizeAppSettings(raw: unknown): FastCatAppSettings {
  if (!raw || typeof raw !== 'object') {
    return createDefaultAppSettings();
  }

  const input = asRecord(raw);
  const pathsInput = asRecord(input.paths);
  const defaultSettings = createDefaultAppSettings();
  const placementMode =
    pathsInput.placementMode === 'portable' ? 'portable' : defaultSettings.paths.placementMode;

  return {
    paths: {
      contentRootPath: normalizeStoragePathValue(pathsInput.contentRootPath),
      dataRootPath: normalizeStoragePathValue(pathsInput.dataRootPath),
      tempRootPath: normalizeStoragePathValue(pathsInput.tempRootPath),
      proxiesRootPath: normalizeStoragePathValue(pathsInput.proxiesRootPath),
      ephemeralTmpRootPath: normalizeStoragePathValue(pathsInput.ephemeralTmpRootPath),
      placementMode,
    },
  };
}

export function normalizeWorkspaceSettings(raw: unknown): FastCatWorkspaceSettings {
  return normalizeAppSettings(raw);
}
