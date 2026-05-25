import { VIDEO_CORE_LIMITS } from '../../constants';

export class CompositorOperationQueue {
  private queue: Promise<unknown> = Promise.resolve();

  public run<T>(fn: (signal: AbortSignal) => Promise<T> | T, label = 'op'): Promise<T> {
    const run = async (): Promise<T> => {
      const controller = new AbortController();
      const watchdog = setTimeout(() => {
        controller.abort();
        console.warn(
          `[VideoCompositor] opQueue watchdog: "${label}" exceeded ` +
            `${VIDEO_CORE_LIMITS.OP_QUEUE_WATCHDOG_MS}ms; aborting to release the queue`,
        );
      }, VIDEO_CORE_LIMITS.OP_QUEUE_WATCHDOG_MS);

      try {
        return await fn(controller.signal);
      } finally {
        clearTimeout(watchdog);
      }
    };

    const result = this.queue.then(run, run);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }

  public async drain(): Promise<void> {
    await this.queue.catch(() => undefined);
  }
}
