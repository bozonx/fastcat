import { serializeTimelineToOtio } from '../timeline/otio-serializer';
import type { TimelineDocument } from '../timeline/types';

self.addEventListener('message', (event: MessageEvent<TimelineDocument>) => {
  try {
    const doc = event.data;
    const serialized = serializeTimelineToOtio(doc);
    self.postMessage({ success: true, serialized });
  } catch (error) {
    self.postMessage({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});
