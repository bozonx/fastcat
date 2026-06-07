import type { Ref } from 'vue';
import { createDevLogger } from '~/utils/dev-logger';

const log = createDevLogger('UiActionRunner');

export interface UiActionRunnerState {
  isLoading: Ref<boolean>;
  error: Ref<string | null>;
}

export interface ToastOptions {
  title: string;
  description?: string;
  color?: 'primary' | 'neutral' | 'success' | 'warning' | 'error' | 'red';
  icon?: string;
}

export interface UiActionRunnerDeps {
  toast: {
    add: (options: ToastOptions) => void;
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
    } catch (e: unknown) {
      if (params.ignoreError?.(e)) {
        return null;
      }

      // Log the full stack trace so the toast has something meaningful to show
      // (otherwise generic messages like "I/O error at _files" hide the root cause).
      log.error(`[${params.toastTitle}]`, e);

      const message = e instanceof Error ? e.message : params.defaultErrorMessage;
      state.error.value = message;
      deps.toast.add({
        color: 'error',
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
