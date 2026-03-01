import { type Ref } from 'vue';

export interface UiActionRunnerState {
  isLoading: Ref<boolean>;
  error: Ref<string | null>;
}

export interface UiActionRunnerDeps {
  toast: {
    add: (options: any) => void;
  };
}

export function createUiActionRunner(state: UiActionRunnerState, deps: UiActionRunnerDeps) {
  return async function runWithUiFeedback<T>(params: {
    action: () => Promise<T>;
    defaultErrorMessage: string;
    toastTitle: string;
    toastDescription?: () => string;
    ignoreError?: (e: unknown) => boolean;
    rethrow?: boolean;
  }): Promise<T | null> {
    state.error.value = null;
    state.isLoading.value = true;
    try {
      return await params.action();
    } catch (e: any) {
      if (params.ignoreError?.(e)) {
        return null;
      }

      state.error.value = e?.message ?? params.defaultErrorMessage;
      deps.toast.add({
        color: 'red',
        title: params.toastTitle,
        description:
          params.toastDescription?.() ?? (state.error.value || params.defaultErrorMessage),
      });

      if (params.rethrow) throw e;
      return null;
    } finally {
      state.isLoading.value = false;
    }
  };
}
