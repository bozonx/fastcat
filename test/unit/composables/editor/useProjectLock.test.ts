/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useProjectLock } from '~/composables/editor/useProjectLock';

const createdChannels: any[] = [];

class MockBroadcastChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  constructor() {
    createdChannels.push(this);
  }
}

describe('useProjectLock', () => {
  beforeEach(() => {
    createdChannels.length = 0;
    vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
    vi.stubGlobal('navigator', {
      locks: {
        request: vi.fn().mockImplementation(async (name, options, callback) => {
          const lock = { mode: options.mode };
          await callback(lock);
          return true;
        }),
      },
    });
  });

  it('acquireLock sets lockedProjectId when Web Locks API is available', async () => {
    const lock = useProjectLock();
    const result = await lock.acquireLock('project-1');
    expect(result).toBe(true);
    expect(lock.isLocked()).toBe(true);
  });

  it('acquireLock returns true when Web Locks API is not supported', async () => {
    vi.stubGlobal('navigator', {});
    const lock = useProjectLock();
    const result = await lock.acquireLock('project-1');
    expect(result).toBe(true);
    expect(lock.isLocked()).toBe(true);
  });

  it('releaseLock clears lockedProjectId', async () => {
    const lock = useProjectLock();
    await lock.acquireLock('project-1');
    await lock.releaseLock();
    expect(lock.isLocked()).toBe(false);
  });

  it('stealLock posts message and acquires lock', async () => {
    const lock = useProjectLock();
    const result = await lock.stealLock('project-1');
    expect(result).toBe(true);
    expect(createdChannels.length).toBeGreaterThan(0);
    const channel = createdChannels[createdChannels.length - 1];
    expect(channel.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'lock:steal', projectId: 'project-1' }),
    );
  });

  it('isLockLost tracks steal events', async () => {
    const lock = useProjectLock();
    await lock.acquireLock('project-1');

    expect(createdChannels.length).toBeGreaterThan(0);
    const channel = createdChannels[0];
    if (channel.onmessage) {
      await channel.onmessage({
        data: { type: 'lock:steal', projectId: 'project-1', requesterTabId: 'other-tab' },
      } as MessageEvent);
    }

    expect(lock.isLockLost.value).toBe(true);
    expect(lock.isLocked()).toBe(false);
  });

  it('onBeforeRelease callback is called when lock is stolen', async () => {
    const lock = useProjectLock();
    await lock.acquireLock('project-1');

    const onBeforeRelease = vi.fn().mockResolvedValue(undefined);
    lock.setOnBeforeRelease(onBeforeRelease);

    const channel = createdChannels[0];
    if (channel.onmessage) {
      await channel.onmessage({
        data: { type: 'lock:steal', projectId: 'project-1', requesterTabId: 'other-tab' },
      } as MessageEvent);
    }

    expect(onBeforeRelease).toHaveBeenCalledOnce();
    expect(lock.isLockLost.value).toBe(true);
  });

  it('onBeforeRelease is not called when steal is for a different project', async () => {
    const lock = useProjectLock();
    await lock.acquireLock('project-1');

    const onBeforeRelease = vi.fn().mockResolvedValue(undefined);
    lock.setOnBeforeRelease(onBeforeRelease);

    const channel = createdChannels[0];
    if (channel.onmessage) {
      await channel.onmessage({
        data: { type: 'lock:steal', projectId: 'project-2', requesterTabId: 'other-tab' },
      } as MessageEvent);
    }

    // Different project — our lock should remain, callback should not be called
    expect(onBeforeRelease).not.toHaveBeenCalled();
    expect(lock.isLocked()).toBe(true);
  });

  it('setOnBeforeRelease can clear the callback by passing null', async () => {
    const lock = useProjectLock();
    await lock.acquireLock('project-1');

    const onBeforeRelease = vi.fn().mockResolvedValue(undefined);
    lock.setOnBeforeRelease(onBeforeRelease);
    lock.setOnBeforeRelease(null);

    const channel = createdChannels[0];
    if (channel.onmessage) {
      await channel.onmessage({
        data: { type: 'lock:steal', projectId: 'project-1', requesterTabId: 'other-tab' },
      } as MessageEvent);
    }

    expect(onBeforeRelease).not.toHaveBeenCalled();
    expect(lock.isLockLost.value).toBe(true);
  });

  it('does not register a beforeunload event listener', () => {
    const addEventListenerSpy = vi.fn();
    vi.stubGlobal('window', {
      addEventListener: addEventListenerSpy,
    });

    useProjectLock();

    const beforeunloadCalls = addEventListenerSpy.mock.calls.filter(
      (call) => call[0] === 'beforeunload',
    );
    expect(beforeunloadCalls).toHaveLength(0);
  });
});
