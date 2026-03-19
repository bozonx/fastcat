import { z } from 'zod';
import type { FastCatAppSettings, FastCatWorkspaceSettings } from '../defaults';
import { createDefaultAppSettings } from '../helpers';

const getAppSchema = () => {
  const defaults = createDefaultAppSettings();
  return z.object({
    paths: z.object({
      contentRootPath: z.string().trim().catch(defaults.paths.contentRootPath),
      dataRootPath: z.string().trim().catch(defaults.paths.dataRootPath),
      tempRootPath: z.string().trim().catch(defaults.paths.tempRootPath),
      proxiesRootPath: z.string().trim().catch(defaults.paths.proxiesRootPath),
      ephemeralTmpRootPath: z.string().trim().catch(defaults.paths.ephemeralTmpRootPath),
      placementMode: z.enum(['system-default', 'portable']).catch(defaults.paths.placementMode),
    }).catch(defaults.paths),
  }).catch(defaults);
};

export function normalizeAppSettings(raw: unknown): FastCatAppSettings {
  const schema = getAppSchema();
  if (!raw || typeof raw !== 'object') {
     return schema.parse({});
  }
  return schema.parse(raw);
}

export function normalizeWorkspaceSettings(raw: unknown): FastCatWorkspaceSettings {
  return normalizeAppSettings(raw);
}
