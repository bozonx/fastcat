import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import { createUiActionRunner } from '~/composables/fileManager/useUiActionRunner';

describe('useUiActionRunner', () => {
  it('should run action successfully, managing isLoading state', async () => {
    const state = { isLoading: ref(false), error: ref<string | null>(null) };
    const toast = { add: vi.fn() };
    const runner = createUiActionRunner(state, { toast });

    const action = vi.fn().mockResolvedValue('success-result');

    const promise = runner({
      action,
      defaultErrorMessage: 'err',
      toastTitle: 'title',
    });

    expect(state.isLoading.value).toBe(true);
    expect(state.error.value).toBeNull();

    const result = await promise;

    expect(result).toBe('success-result');
    expect(state.isLoading.value).toBe(false);
    expect(state.error.value).toBeNull();
    expect(toast.add).not.toHaveBeenCalled();
  });

  it('should handle errors, update error state, and show toast', async () => {
    const state = { isLoading: ref(false), error: ref<string | null>(null) };
    const toast = { add: vi.fn() };
    const runner = createUiActionRunner(state, { toast });

    const action = vi.fn().mockRejectedValue(new Error('Custom error message'));

    const result = await runner({
      action,
      defaultErrorMessage: 'default error',
      toastTitle: 'Error Title',
    });

    expect(result).toBeNull();
    expect(state.isLoading.value).toBe(false);
    expect(state.error.value).toBe('Custom error message');
    expect(toast.add).toHaveBeenCalledWith({
      color: 'red',
      title: 'Error Title',
      description: 'Custom error message',
    });
  });

  it('should use default error message if error has no message', async () => {
    const state = { isLoading: ref(false), error: ref<string | null>(null) };
    const toast = { add: vi.fn() };
    const runner = createUiActionRunner(state, { toast });

    const action = vi.fn().mockRejectedValue({}); // no message

    await runner({
      action,
      defaultErrorMessage: 'Fallback error',
      toastTitle: 'Error Title',
    });

    expect(state.error.value).toBe('Fallback error');
    expect(toast.add).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Fallback error',
      }),
    );
  });

  it('should ignore error if ignoreError returns true', async () => {
    const state = { isLoading: ref(false), error: ref<string | null>(null) };
    const toast = { add: vi.fn() };
    const runner = createUiActionRunner(state, { toast });

    const action = vi.fn().mockRejectedValue(new Error('AbortError'));

    const result = await runner({
      action,
      defaultErrorMessage: 'err',
      toastTitle: 'title',
      ignoreError: (e: any) => e.message === 'AbortError',
    });

    expect(result).toBeNull();
    expect(state.isLoading.value).toBe(false);
    // When ignored, error state is NOT updated and toast is NOT shown
    expect(state.error.value).toBeNull();
    expect(toast.add).not.toHaveBeenCalled();
  });

  it('should rethrow error if rethrow is true', async () => {
    const state = { isLoading: ref(false), error: ref<string | null>(null) };
    const toast = { add: vi.fn() };
    const runner = createUiActionRunner(state, { toast });

    const action = vi.fn().mockRejectedValue(new Error('Fatal error'));

    const promise = runner({
      action,
      defaultErrorMessage: 'err',
      toastTitle: 'title',
      rethrow: true,
    });

    await expect(promise).rejects.toThrow('Fatal error');
    expect(state.isLoading.value).toBe(false);
    expect(state.error.value).toBe('Fatal error');
    expect(toast.add).toHaveBeenCalled();
  });
});
