import { installWorkerIoBudgetListener } from '~/utils/io/io-budget-worker';

import { handleTimelineSerializeMessage } from './timeline-serializer-engine';
import type { TimelineDocument } from '../timeline/types';

installWorkerIoBudgetListener();

self.addEventListener('message', (event: MessageEvent<TimelineDocument>) => {
  const result = handleTimelineSerializeMessage(event.data);
  self.postMessage(result);
});
