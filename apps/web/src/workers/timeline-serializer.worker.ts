import { installWorkerIoBudgetListener } from '~/utils/io/io-budget-worker';

import {
  handleTimelineSerializeMessage,
  isTimelineSerializeMessage,
} from './timeline-serializer-engine';

installWorkerIoBudgetListener();

self.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (!isTimelineSerializeMessage(event.data)) {
    return;
  }

  const result = handleTimelineSerializeMessage(event.data);
  self.postMessage(result);
});
