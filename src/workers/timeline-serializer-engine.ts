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
