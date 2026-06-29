/**
 * Cooperative event-loop yield for tight worker loops (e.g. the export encode
 * loop). `setTimeout(0)` is the obvious primitive but nested timers in a worker
 * are clamped to ~4 ms by the platform, so a loop that yields every frame pays a
 * few ms of pure idle on every yield — meaningful on decode-bound exports where
 * frames render in well under that. A MessageChannel round-trip is also a
 * macrotask (so it still flushes pending `postMessage`s and lets cancellation
 * messages and progress callbacks run), but it has no minimum-delay clamp, so it
 * unblocks as soon as the queued work drains.
 *
 * Resolvers are batched onto a single shared port so repeated calls within one
 * turn coalesce into one channel message instead of allocating a port per yield.
 */
let sharedChannel: MessageChannel | null = null;
let pendingResolvers: Array<() => void> = [];

export function yieldToEventLoop(): Promise<void> {
  const ChannelCtor = (globalThis as { MessageChannel?: typeof MessageChannel }).MessageChannel;
  if (typeof ChannelCtor !== 'function') {
    // Environments without MessageChannel (some test runners) fall back to the
    // clamped timer; correctness is identical, only the latency differs.
    return new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  if (!sharedChannel) {
    sharedChannel = new ChannelCtor();
    sharedChannel.port1.onmessage = () => {
      const batch = pendingResolvers;
      pendingResolvers = [];
      for (const resolve of batch) resolve();
    };
    // port1 must be started to receive messages; some implementations require an
    // explicit start when onmessage is assigned after construction.
    sharedChannel.port1.start?.();
  }

  return new Promise<void>((resolve) => {
    pendingResolvers.push(resolve);
    sharedChannel!.port2.postMessage(0);
  });
}

/** Test-only: drop the shared channel so a fresh one is created on next yield. */
export function resetYieldScheduler(): void {
  sharedChannel?.port1.close();
  sharedChannel?.port2.close();
  sharedChannel = null;
  pendingResolvers = [];
}
