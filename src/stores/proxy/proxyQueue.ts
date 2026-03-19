import type { Ref } from 'vue';
import type PQueue from 'p-queue';
import { getMediaTaskQueue } from '~/utils/media-task-queue';

export interface ProxyQueueModule {
  proxyQueue: Ref<PQueue>;
}

export function createProxyQueueModule(): ProxyQueueModule {
  return {
    proxyQueue: getMediaTaskQueue(),
  };
}
