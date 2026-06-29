import { createDevLogger } from '~/utils/dev-logger';

/**
 * Lightweight, flag-gated timeline performance instrumentation.
 *
 * Enable in the browser console with:
 *   localStorage.fastcatPerfTimeline = '1'   // then reload
 * Disable with:
 *   delete localStorage.fastcatPerfTimeline
 *
 * When disabled, `measureTimeline`/`markTimeline` add a single boolean check and
 * call straight through — effectively zero overhead on the hot path. This mirrors
 * the existing `fastcatPerfZoom` switch used by the virtualization profiler.
 */

const perfLog = createDevLogger('timeline-perf');

let cachedEnabled: boolean | null = null;

export function isTimelinePerfEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  try {
    cachedEnabled =
      typeof localStorage !== 'undefined' && localStorage.getItem('fastcatPerfTimeline') === '1';
  } catch {
    cachedEnabled = false;
  }
  return cachedEnabled;
}

/** Reset the cached flag (used by tests; the flag is otherwise read once per session). */
export function resetTimelinePerfFlag(): void {
  cachedEnabled = null;
}

export interface MeasureOptions {
  /** Only log when the measured duration is at least this many ms (default 0 = always). */
  minMs?: number;
  /** Lazily-built extra context appended to the log line (clip counts etc.). */
  extra?: () => string;
}

/**
 * Run `fn`, returning its result. When the perf flag is on and the call took at
 * least `minMs`, log `<label>: <ms>ms (<extra>)`.
 */
export function measureTimeline<T>(label: string, fn: () => T, opts?: MeasureOptions): T {
  if (!isTimelinePerfEnabled()) return fn();
  const t0 = performance.now();
  const result = fn();
  const dt = performance.now() - t0;
  if (dt >= (opts?.minMs ?? 0)) {
    const extra = opts?.extra?.();
    perfLog.debug(`${label}: ${dt.toFixed(1)}ms${extra ? ` (${extra})` : ''}`);
  }
  return result;
}

/** Log a pre-measured duration (for spans that can't be wrapped in a single fn). */
export function markTimeline(label: string, ms: number, extra?: string): void {
  if (!isTimelinePerfEnabled()) return;
  perfLog.debug(`${label}: ${ms.toFixed(1)}ms${extra ? ` (${extra})` : ''}`);
}

interface Accumulator {
  count: number;
  total: number;
  max: number;
}

const accumulators = new Map<string, Accumulator>();

/**
 * Accumulate per-event samples (e.g. one marquee/scroll move per frame) and emit
 * a single summary line on `flushTimelineSamples(label)` — avoids flooding the
 * console with one line per pointermove while still surfacing the worst frame.
 */
export function sampleTimeline(label: string, ms: number): void {
  if (!isTimelinePerfEnabled()) return;
  const acc = accumulators.get(label) ?? { count: 0, total: 0, max: 0 };
  acc.count += 1;
  acc.total += ms;
  acc.max = Math.max(acc.max, ms);
  accumulators.set(label, acc);
}

export function flushTimelineSamples(label: string): void {
  if (!isTimelinePerfEnabled()) return;
  const acc = accumulators.get(label);
  if (!acc || acc.count === 0) return;
  perfLog.debug(
    `${label}: ${acc.count} samples, avg ${(acc.total / acc.count).toFixed(1)}ms, ` +
      `max ${acc.max.toFixed(1)}ms, total ${acc.total.toFixed(1)}ms`,
  );
  accumulators.delete(label);
}
