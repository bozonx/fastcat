import type { Ref } from 'vue';
import type PQueue from 'p-queue';
import { getEncodeTaskQueue } from '~/utils/media-task-queue';

export interface ProxyQueueModule {
  proxyQueue: Ref<PQueue>;
}

export function createProxyQueueModule(): ProxyQueueModule {
  return {
    // Proxy generation is a long-running encode: it lives on the dedicated
    // (serial) encode pool so it can never occupy an interactive thumbnail slot.
    proxyQueue: getEncodeTaskQueue(),
  };
}
