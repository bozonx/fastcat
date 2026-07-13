import { MAX_SAFE_TICKS, TICKS_PER_MICROSECOND } from '~/utils/time';

/** FastCat document version whose canonical timeline numbers are ticks. */
export const TIMELINE_TICKS_DOCUMENT_VERSION = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function legacyUsToTicks(value: number): number {
  return Math.min(MAX_SAFE_TICKS, Math.round(value * TICKS_PER_MICROSECOND));
}

function migrateTimeFields(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(migrateTimeFields);
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (key.endsWith('Us') && typeof child === 'number' && Number.isFinite(child)) {
      value[key] = legacyUsToTicks(child);
      continue;
    }
    migrateTimeFields(child);
  }
}

function getDocumentVersion(timeline: Record<string, unknown>): number {
  const metadata = timeline.metadata;
  if (!isRecord(metadata) || !isRecord(metadata.fastcat)) return 0;
  const version = metadata.fastcat.version;
  return typeof version === 'number' && Number.isFinite(version) ? version : 0;
}

/**
 * OTIO RationalTime values are converted to ticks independently. This migration
 * only scales FastCat metadata, which historically stored raw microseconds.
 */
export function migrateLegacyOtioMetadataToTicks(timeline: unknown): boolean {
  if (!isRecord(timeline) || getDocumentVersion(timeline) >= TIMELINE_TICKS_DOCUMENT_VERSION) {
    return false;
  }

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;

    const metadata = value.metadata;
    if (isRecord(metadata) && isRecord(metadata.fastcat)) {
      migrateTimeFields(metadata.fastcat);
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'metadata') continue;
      visit(child);
    }
  };

  visit(timeline);
  return true;
}
