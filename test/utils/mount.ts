import { mountSuspended } from '@nuxt/test-utils/runtime';
import type { Component } from 'vue';

import { setupTestPinia, type SetupTestPiniaOptions } from './pinia';

export interface MountWithNuxtOptions extends SetupTestPiniaOptions {
  props?: Record<string, unknown>;
}

export async function mountWithNuxt(component: Component, options?: MountWithNuxtOptions) {
  setupTestPinia({ initialState: options?.initialState });

  return await mountSuspended(component as any, {
    props: options?.props as any,
  });
}
