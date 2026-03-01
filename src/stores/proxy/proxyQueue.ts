import { markRaw, ref, watch, type Ref } from 'vue';
import PQueue from 'p-queue';

export interface ProxyQueueModule {
  proxyQueue: Ref<PQueue>;
}

export function createProxyQueueModule(params: {
  concurrency: Ref<number>;
}): ProxyQueueModule {
  const proxyQueue = ref(markRaw(new PQueue({ concurrency: params.concurrency.value })));

  watch(
    () => params.concurrency.value,
    (val) => {
      proxyQueue.value.concurrency = val;
    },
  );

  return { proxyQueue };
}
