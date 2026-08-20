import { serializeTimelineToOtio } from '../timeline/otio-serializer';
import type { TimelineDocument } from '../timeline/types';

export interface TimelineSerializeResult {
  success: true;
  serialized: string;
}

export interface TimelineSerializeError {
  success: false;
  error: string;
}

export function isTimelineSerializeMessage(value: unknown): value is TimelineDocument {
  if (!value || typeof value !== 'object') return false;
  const input = value as { OTIO_SCHEMA?: unknown; type?: unknown };
  return input.OTIO_SCHEMA === 'Timeline.1' && input.type !== 'io-init';
}

export function handleTimelineSerializeMessage(
  doc: TimelineDocument,
): TimelineSerializeResult | TimelineSerializeError {
  try {
    const serialized = serializeTimelineToOtio(doc);
    return { success: true, serialized };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
