/** @vitest-environment node */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  callHostRpc,
  isHostRpcAvailable,
  registerHostRpc,
  settleHostRpc,
} from '~/utils/embed/host-rpc';

afterEach(() => {
  registerHostRpc(null);
  vi.useRealTimers();
});

describe('host RPC', () => {
  it('refuses to call when no host is connected', async () => {
    expect(isHostRpcAvailable()).toBe(false);
    await expect(callHostRpc('stt', {})).rejects.toThrow(/No host available/);
  });

  it('resolves the caller with the host answer matched by request id', async () => {
    const sent: { requestId: string; payload: unknown }[] = [];
    registerHostRpc((_channel, requestId, payload) => sent.push({ requestId, payload }));

    const pending = callHostRpc('stt', { audio: 'x' });
    expect(sent).toHaveLength(1);

    settleHostRpc(sent[0]!.requestId, { result: { text: 'hello' } });
    await expect(pending).resolves.toEqual({ text: 'hello' });
  });

  it('rejects when the host reports a failure', async () => {
    const ids: string[] = [];
    registerHostRpc((_channel, requestId) => ids.push(requestId));

    const pending = callHostRpc('llm', {});
    settleHostRpc(ids[0]!, { error: 'quota exceeded' });
    await expect(pending).rejects.toThrow('quota exceeded');
  });

  it('keeps concurrent calls apart', async () => {
    const ids: string[] = [];
    registerHostRpc((_channel, requestId) => ids.push(requestId));

    const first = callHostRpc('stt', { n: 1 });
    const second = callHostRpc('stt', { n: 2 });
    expect(new Set(ids).size).toBe(2);

    settleHostRpc(ids[1]!, { result: 'second' });
    settleHostRpc(ids[0]!, { result: 'first' });

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
  });

  it('gives up on a host that never answers', async () => {
    vi.useFakeTimers();
    registerHostRpc(() => {});

    const pending = callHostRpc('stt', {}, { timeoutMs: 1_000 });
    const assertion = expect(pending).rejects.toThrow(/did not answer/);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });

  it('supports cancellation', async () => {
    registerHostRpc(() => {});
    const controller = new AbortController();

    const pending = callHostRpc('llm', {}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
  });

  it('fails everything in flight when the host disconnects', async () => {
    registerHostRpc(() => {});
    const pending = callHostRpc('stt', {});

    registerHostRpc(null);
    await expect(pending).rejects.toThrow(/host connection went away/);
  });
});
