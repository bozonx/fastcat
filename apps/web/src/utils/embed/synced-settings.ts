import { createDevLogger } from '~/utils/dev-logger';
import type { FastCatUserSettings } from '~/utils/settings/defaults';

const log = createDevLogger('embed-synced-settings');

/** Bumped whenever the shape below changes in a way older payloads cannot fill. */
export const EMBED_SETTINGS_SCHEMA_VERSION = 1;

/**
 * The slice of user settings an embedded session hands to its host to keep.
 *
 * The rule for what belongs here is whether the user chose it deliberately.
 * Remapped keys, mouse bindings, snapping habits and export presets are work
 * someone did once and would resent redoing; panel sizes and scroll positions
 * are derived from a viewport and cost nothing to lose.
 *
 * Nothing about the host's own concerns leaks in either direction: the host
 * stores this as an opaque blob and never needs to understand a field of it.
 * Storing it host-side rather than in the iframe's `localStorage` is what makes
 * preferences survive a third-party storage purge or a change of device.
 */
const SYNCED_KEYS = [
  'hotkeys',
  'mouse',
  'timeline',
  'ui',
  'exportPresets',
  'projectPresets',
  'projectDefaults',
  'stopFrames',
  'deleteWithoutConfirmation',
] as const;

type SyncedKey = (typeof SYNCED_KEYS)[number];

export interface EmbedSyncedSettings {
  version: number;
  values: Partial<Pick<FastCatUserSettings, SyncedKey>> & {
    /** Custom presets travel; their collapsed/expanded state does not. */
    presets?: Pick<FastCatUserSettings['presets'], 'custom' | 'defaultTextPresetId'>;
  };
}

export function extractSyncedSettings(settings: FastCatUserSettings): EmbedSyncedSettings {
  const values: EmbedSyncedSettings['values'] = {};
  for (const key of SYNCED_KEYS) {
    values[key] = settings[key] as never;
  }
  values.presets = {
    custom: settings.presets.custom,
    defaultTextPresetId: settings.presets.defaultTextPresetId,
  };

  // Settings come off a reactive store, and reactive proxies are not
  // structured-cloneable — posting one to the host throws. A JSON round trip
  // both unwraps them and makes the snapshot a true point-in-time copy, which
  // is what the host is being asked to store anyway. Every field here is
  // already JSON-persisted on disk, so nothing is lost in the trip.
  return JSON.parse(
    JSON.stringify({ version: EMBED_SETTINGS_SCHEMA_VERSION, values }),
  ) as EmbedSyncedSettings;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Merges leaf-wise so a payload written by an older editor keeps new defaults. */
function mergeInto(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(value) && isPlainObject(target[key])) {
      mergeInto(target[key] as Record<string, unknown>, value);
    } else if (value !== undefined) {
      target[key] = value;
    }
  }
}

/**
 * Applies settings the host had stored, in place.
 *
 * A payload from a *newer* editor is ignored outright rather than merged: its
 * unknown shape could silently corrupt bindings, and losing one session's
 * preferences beats persisting a broken set back to the host.
 */
export function applySyncedSettings(settings: FastCatUserSettings, incoming: unknown): boolean {
  if (!isPlainObject(incoming)) return false;

  const version = incoming.version;
  if (typeof version !== 'number' || version > EMBED_SETTINGS_SCHEMA_VERSION) {
    log.warn('Ignoring preferences written by a newer editor', version);
    return false;
  }

  const values = incoming.values;
  if (!isPlainObject(values)) return false;

  for (const [key, value] of Object.entries(values)) {
    if (!isPlainObject(value)) {
      if (key === 'deleteWithoutConfirmation' && typeof value === 'boolean') {
        settings.deleteWithoutConfirmation = value;
      }
      continue;
    }
    const target = (settings as unknown as Record<string, unknown>)[key];
    if (isPlainObject(target)) mergeInto(target, value);
  }

  return true;
}
