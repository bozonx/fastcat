import { createPinia, setActivePinia } from 'pinia';

export interface SetupTestPiniaOptions {
  initialState?: Record<string, unknown>;
}

export function setupTestPinia(options?: SetupTestPiniaOptions) {
  const pinia = createPinia();

  if (options?.initialState) {
    pinia.state.value = options.initialState as any;
  }

  setActivePinia(pinia);
  return pinia;
}
