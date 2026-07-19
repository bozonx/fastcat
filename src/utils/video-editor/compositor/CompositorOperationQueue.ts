import { VIDEO_CORE_LIMITS } from '../../constants';
import { createDevLogger } from '~/utils/dev-logger';

const log = createDevLogger('CompositorOperationQueue');

export type CompositorOperationPriority = 'interactive' | 'background';

interface QueuedOperation {
  fn: (signal: AbortSignal) => Promise<unknown> | unknown;
  label: string;
  priority: CompositorOperationPriority;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

export class CompositorOperationQueue {
  private readonly pending: QueuedOperation[] = [];
  private readonly idleResolvers = new Set<() => void>();
  private activeController: AbortController | null = null;
  private activePriority: CompositorOperationPriority | null = null;
  private running = false;

  public run<T>(
    fn: (signal: AbortSignal) => Promise<T> | T,
    label = 'op',
    priority: CompositorOperationPriority = 'interactive',
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const operation: QueuedOperation = {
        fn: fn as (signal: AbortSignal) => Promise<unknown> | unknown,
        label,
        priority,
        resolve: resolve as (value: unknown) => void,
        reject,
      };
      if (priority === 'interactive') {
        const firstBackground = this.pending.findIndex((item) => item.priority === 'background');
        if (firstBackground >= 0) this.pending.splice(firstBackground, 0, operation);
        else this.pending.push(operation);
      } else {
        this.pending.push(operation);
      }
      if (priority === 'interactive' && this.activePriority === 'background') {
        this.activeController?.abort();
      }
      this.pump();
    });
  }

  public async drain(): Promise<void> {
    if (!this.running && this.pending.length === 0) return;
    await new Promise<void>((resolve) => this.idleResolvers.add(resolve));
  }

  private pump(): void {
    if (this.running) return;
    const operation = this.pending.shift();
    if (!operation) {
      for (const resolve of this.idleResolvers) resolve();
      this.idleResolvers.clear();
      return;
    }

    this.running = true;
    const controller = new AbortController();
    this.activeController = controller;
    this.activePriority = operation.priority;
    const watchdog = setTimeout(() => {
      controller.abort();
      log.warn(
        `[VideoCompositor] opQueue watchdog: "${operation.label}" exceeded ` +
          `${VIDEO_CORE_LIMITS.OP_QUEUE_WATCHDOG_MS}ms; aborting to release the queue`,
      );
    }, VIDEO_CORE_LIMITS.OP_QUEUE_WATCHDOG_MS);

    Promise.resolve()
      .then(() => operation.fn(controller.signal))
      .then(operation.resolve, operation.reject)
      .finally(() => {
        clearTimeout(watchdog);
        this.running = false;
        this.activeController = null;
        this.activePriority = null;
        this.pump();
      });
  }
}
