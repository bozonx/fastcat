/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAutoSave } from '~/utils/auto-save';

describe('auto-save', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('debounces save requests', async () => {
    const doSave = vi.fn().mockResolvedValue(true);
    const autoSave = createAutoSave({ doSave, debounceMs: 100 });

    autoSave.markDirty();
    void autoSave.requestSave();
    autoSave.markDirty();
    void autoSave.requestSave();

    expect(doSave).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    
    // allow event loop to process queue
    await vi.runAllTimersAsync();
    
    expect(doSave).toHaveBeenCalledTimes(1);
  });

  it('queues saves and only runs one at a time', async () => {
    let resolveSave: (v: boolean) => void = () => {};
    const doSave = vi.fn().mockImplementation(() => new Promise((r) => { resolveSave = r; }));
    const autoSave = createAutoSave({ doSave, debounceMs: 100 });

    // First save
    autoSave.markDirty();
    void autoSave.requestSave();
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();
    expect(doSave).toHaveBeenCalledTimes(1);

    // Second request while first is still running
    autoSave.markDirty();
    void autoSave.requestSave();
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();
    
    // Still 1 because first is not resolved
    expect(doSave).toHaveBeenCalledTimes(1);

    // Finish first save
    resolveSave(true);
    await vi.runAllTimersAsync();

    // Now second save should have started
    expect(doSave).toHaveBeenCalledTimes(2);
  });

  it('clears queue on reset', async () => {
    let resolveSave: (v: boolean) => void = () => {};
    const doSave = vi.fn().mockImplementation(() => new Promise((r) => { resolveSave = r; }));
    const autoSave = createAutoSave({ doSave, debounceMs: 100 });

    // Trigger first save
    autoSave.markDirty();
    void autoSave.requestSave();
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();
    expect(doSave).toHaveBeenCalledTimes(1);

    // Trigger second save request
    autoSave.markDirty();
    void autoSave.requestSave();
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();

    // Reset while first is running and second is queued
    autoSave.reset();

    // Now pretend we are in a NEW project and make TWO changes
    autoSave.markDirty();
    autoSave.markDirty();
    // currentRevision is now 2, savedRevision is 0.
    
    // Finish first save (which was for the OLD project)
    resolveSave(true);
    await vi.runAllTimersAsync();

    // The zombie task that was in the queue for the OLD project 
    // will now run and see that it's dirty (savedRevision=1, currentRevision=2).
    // It will call doSave()!
    expect(doSave).toHaveBeenCalledTimes(1);
  });
});
