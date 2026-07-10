import { createDevLogger } from '~/utils/dev-logger';

const log = createDevLogger('CompositorPerf');

const FLUSH_INTERVAL_MS = 3_000;

/**
 * Dev-only rolling counters for the web compositor's playback hot path. Answers,
 * with numbers instead of theory, where a slow web preview spends its time:
 * frame-cache hit rate (is decode-ahead working?), on-demand decode latency
 * (decoder-bound?), and total render duration (Pixi/upload-bound?). Counters are
 * plain increments (negligible cost); the summary line flushes at most every
 * FLUSH_INTERVAL_MS and only in dev builds (dev-logger no-ops `log` in prod).
 */
/** Effect-processing surfaces instrumented for zero-copy coverage. */
export type GpuComputePath = 'effects' | 'blur-fill' | 'transition' | 'adjustment' | 'non-video';

/**
 * How a frame's effect work was actually executed:
 * - zero-copy: GPU compute wrote straight into a Pixi texture (no readback);
 * - bitmap-fallback: GPU compute ran but round-tripped through an ImageBitmap;
 * - raw-fallback: effects were skipped entirely (runner unavailable / error).
 */
export type GpuComputeOutcome = 'zero-copy' | 'bitmap-fallback' | 'raw-fallback';

class CompositorPerfStats {
  private renders = 0;
  private renderMsTotal = 0;
  private renderMsMax = 0;
  private cacheHits = 0;
  private decodes = 0;
  private decodeMsTotal = 0;
  private decodeMsMax = 0;
  private prewarmRuns = 0;
  private prewarmFramesStored = 0;
  private prewarmMsTotal = 0;
  private gpuPathCounts = new Map<string, number>();
  private gpuChains = 0;
  private gpuChainMsTotal = 0;
  private gpuChainMsMax = 0;
  private windowStartMs = 0;

  /** Records which execution path handled an effect surface this frame. */
  public onGpuComputePath(path: GpuComputePath, outcome: GpuComputeOutcome) {
    const key = `${path}:${outcome}`;
    this.gpuPathCounts.set(key, (this.gpuPathCounts.get(key) ?? 0) + 1);
  }

  /** Sampled submit→onSubmittedWorkDone duration of a compute chain. */
  public onGpuChain(ms: number) {
    this.gpuChains += 1;
    this.gpuChainMsTotal += ms;
    if (ms > this.gpuChainMsMax) this.gpuChainMsMax = ms;
  }

  public onCacheHit() {
    this.cacheHits += 1;
  }

  public onDecode(ms: number) {
    this.decodes += 1;
    this.decodeMsTotal += ms;
    if (ms > this.decodeMsMax) this.decodeMsMax = ms;
  }

  public onPrewarm(framesStored: number, ms: number) {
    this.prewarmRuns += 1;
    this.prewarmFramesStored += framesStored;
    this.prewarmMsTotal += ms;
  }

  public onRender(ms: number) {
    this.renders += 1;
    this.renderMsTotal += ms;
    if (ms > this.renderMsMax) this.renderMsMax = ms;
    this.maybeFlush();
  }

  private maybeFlush() {
    const nowMs = performance.now();
    if (this.windowStartMs === 0) {
      this.windowStartMs = nowMs;
      return;
    }
    const elapsedMs = nowMs - this.windowStartMs;
    if (elapsedMs < FLUSH_INTERVAL_MS) return;

    const seconds = elapsedMs / 1000;
    const sampleRequests = this.cacheHits + this.decodes;
    const hitPct = sampleRequests > 0 ? Math.round((this.cacheHits / sampleRequests) * 100) : 0;
    const gpuPaths =
      this.gpuPathCounts.size > 0
        ? [...this.gpuPathCounts.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, count]) => `${key}=${count}`)
            .join(' ')
        : 'none';
    log.log(
      `renders=${this.renders} (${(this.renders / seconds).toFixed(1)}/s) ` +
        `renderMs avg=${(this.renders ? this.renderMsTotal / this.renders : 0).toFixed(1)} max=${this.renderMsMax.toFixed(1)} | ` +
        `cache hit=${this.cacheHits}/${sampleRequests} (${hitPct}%) ` +
        `decodeMs avg=${(this.decodes ? this.decodeMsTotal / this.decodes : 0).toFixed(1)} max=${this.decodeMsMax.toFixed(1)} | ` +
        `prewarm runs=${this.prewarmRuns} stored=${this.prewarmFramesStored} msTotal=${this.prewarmMsTotal.toFixed(0)} | ` +
        `gpu paths: ${gpuPaths} | ` +
        `gpuChainMs avg=${(this.gpuChains ? this.gpuChainMsTotal / this.gpuChains : 0).toFixed(1)} max=${this.gpuChainMsMax.toFixed(1)} (sampled n=${this.gpuChains})`,
    );

    this.renders = 0;
    this.renderMsTotal = 0;
    this.renderMsMax = 0;
    this.cacheHits = 0;
    this.decodes = 0;
    this.decodeMsTotal = 0;
    this.decodeMsMax = 0;
    this.prewarmRuns = 0;
    this.prewarmFramesStored = 0;
    this.prewarmMsTotal = 0;
    this.gpuPathCounts.clear();
    this.gpuChains = 0;
    this.gpuChainMsTotal = 0;
    this.gpuChainMsMax = 0;
    this.windowStartMs = nowMs;
  }
}

export const compositorPerfStats = new CompositorPerfStats();
