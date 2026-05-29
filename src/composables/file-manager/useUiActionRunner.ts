import type { Ref } from 'vue';

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

      // Стек в консоль обязателен — без него toast'у часто нечего сказать
      // (типа "I/O error at _files"), а реальная причина теряется.
      // eslint-disable-next-line no-console
      console.error(`[${params.toastTitle}]`, e);

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
