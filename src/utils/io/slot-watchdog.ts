/**
 * Held-slot watchdog for the I/O budget.
 *
 * The budget has no built-in timeout: if a caller acquires a slot and never
 * releases it (an exception that skips a `finally`, an abandoned writable), the
 * slot leaks and — because the browser pools are tiny (interactive=2,
 * streaming=1) — that pool stalls every future op forever.
 *
 * This wraps a `release` function with a timer that logs a loud warning if the
 * slot is held longer than `warnMs`, so leaks surface in logs instead of as a
 * silent freeze. It is intentionally **warn-only**: it never force-releases the
 * slot, because a slow-but-alive operation (a large copy, a long export) is
 * still using its datapipe, and returning its slot early would over-subscribe
 * the pool — the exact condition the budget exists to prevent.
 */ import { createDevLogger } from '~/utils/dev-logger';
const log = createDevLogger('slot-watchdog');

export interface SlotWatchdogOptions {
  /** Human-readable label for the warning, e.g. `'interactive'`. */
  label: string;
  /** Hold duration (ms) after which to warn. `<= 0` disables the watchdog. */
  warnMs: number;
  /** Hold duration (ms) after which to force-release the slot. `<= 0` disables. */
  hardReleaseMs?: number;
  /** Warning sink. Defaults to `log.warn`. */
  warn?: (message: string) => void;
}

function defaultWarn(message: string): void {
  log.warn(message);
}

/**
 * Wrap `release` so it is monitored by a held-slot watchdog. Returns a new
 * release function; calling it clears the timer and forwards to `release`
 * exactly once. If the slot is held longer than `hardReleaseMs` it is
 * force-released automatically so the pool cannot stall forever.
 */
export function watchHeldSlot(release: () => void, options: SlotWatchdogOptions): () => void {
  const warn = options.warn ?? defaultWarn;
  const hardReleaseMs = options.hardReleaseMs ?? options.warnMs * 2;

  if (!(options.warnMs > 0) || typeof setTimeout !== 'function') {
    // Watchdog disabled (or no timer available, e.g. some SSR contexts):
    // return release unchanged so behaviour is identical to no watchdog.
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }

  const startedAt = Date.now();
  let warned = false;
  const timer = setTimeout(() => {
    warned = true;
    warn(
      `[io-budget] ${options.label} slot held for >${options.warnMs}ms — possible leaked slot ` +
        `(a release() was likely skipped). The pool will stall until it is released.`,
    );
  }, options.warnMs);
  // Don't keep the event loop alive just for the watchdog (Node/test contexts).
  (timer as unknown as { unref?: () => void })?.unref?.();

  let hardTimer: ReturnType<typeof setTimeout> | undefined;
  if (hardReleaseMs > 0 && typeof setTimeout === 'function') {
    hardTimer = setTimeout(() => {
      if (!released) {
        warn(`[io-budget] ${options.label} slot force-released after ${hardReleaseMs}ms`);
        release();
      }
    }, hardReleaseMs);
    (hardTimer as unknown as { unref?: () => void })?.unref?.();
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    if (hardTimer) clearTimeout(hardTimer);
    if (warned) {
      warn(`[io-budget] ${options.label} slot finally released after ${Date.now() - startedAt}ms`);
    }
    release();
  };
}
