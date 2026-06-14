/**
 * Multi-resolution ("mip") pyramid for waveform peaks.
 *
 * Drawing a waveform means, for each output pixel, taking the max amplitude over
 * the source peak samples that fall under that pixel. When the timeline is zoomed
 * out, a single clip can map hundreds of thousands of source samples onto a few
 * pixels, so the naive binner (`computeWaveformPeakBins`) does O(sourceSamples)
 * work per draw — and that runs for every visible clip on every scroll/zoom
 * frame. That is the dominant cost of the "lags at small zoom" symptom.
 *
 * A mip pyramid precomputes peak-preserving halvings of the source once. At draw
 * time we pick the level where one level-sample covers ~1-2 output pixels, so the
 * binner only ever touches O(outputBins) samples regardless of zoom. The pyramid
 * is memoized by the identity of the source channels array, so it is built at
 * most once per cached peaks buffer.
 */

/** Smallest level length we bother downsampling to. */
const MIN_MIP_LENGTH = 256;

export interface PeakMips {
  /**
   * Pyramid levels, finest first. `levels[0]` is the original channels array
   * (referenced, not copied); each subsequent level halves the length using a
   * peak-preserving (max-of-pairs) downsample.
   */
  levels: readonly Float32Array[][];
  /** `levels[k][ch].length` ≈ `levels[0][ch].length / 2**k`. */
  baseLength: number;
}

let mipCache = new WeakMap<readonly Float32Array[], PeakMips>();

function downsampleHalf(channel: Float32Array): Float32Array {
  const outLength = Math.ceil(channel.length / 2);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const a = channel[i * 2] ?? 0;
    const b = channel[i * 2 + 1] ?? 0;
    const absA = Math.abs(a);
    const absB = Math.abs(b);
    out[i] = absA > absB ? absA : absB;
  }
  return out;
}

/**
 * Build (or return the cached) mip pyramid for a peaks array. The result is keyed
 * by the array identity, so callers should pass the stable cached peaks buffer
 * (e.g. the one held in the media store) rather than a fresh copy.
 */
export function getPeakMips(channels: readonly Float32Array[]): PeakMips {
  const cached = mipCache.get(channels);
  if (cached) return cached;

  const baseLength = channels[0]?.length ?? 0;
  const levels: Float32Array[][] = [channels.map((c) => c)];

  let current = channels;
  let length = baseLength;
  while (length > MIN_MIP_LENGTH) {
    const next = current.map((c) => downsampleHalf(c));
    levels.push(next);
    current = next;
    length = next[0]?.length ?? 0;
    if (length <= 0) break;
  }

  const mips: PeakMips = { levels, baseLength };
  mipCache.set(channels, mips);
  return mips;
}

/**
 * Pick the pyramid level at which one sample covers roughly `samplesPerBin`
 * level-0 samples per output bin or fewer. Returns the level index, clamped to
 * the available range. `level k` corresponds to a stride of `2**k` level-0
 * samples per level-sample.
 */
export function selectMipLevel(mips: PeakMips, samplesPerBin: number): number {
  if (!Number.isFinite(samplesPerBin) || samplesPerBin <= 1) return 0;
  const maxLevel = mips.levels.length - 1;
  // Largest k with 2**k <= samplesPerBin → floor(log2).
  const level = Math.floor(Math.log2(samplesPerBin));
  return Math.max(0, Math.min(maxLevel, level));
}

export interface MipPeakBinsParams {
  channels: readonly Float32Array[];
  /** Inclusive start in level-0 sample coordinates. */
  startIndex: number;
  /** Exclusive end in level-0 sample coordinates. */
  endIndex: number;
  outputBins: number;
  gain?: number;
  /** Precomputed pyramid; built+cached from `channels` when omitted. */
  mips?: PeakMips;
}

/**
 * Mip-accelerated equivalent of `computeWaveformPeakBins`. Indices are given in
 * level-0 coordinates so callers reuse the exact same source-range math as the
 * naive binner; the level selection and coordinate scaling happen internally.
 */
export function computeWaveformPeakBinsFromMips(params: MipPeakBinsParams): Float32Array {
  const peaksCount = params.channels[0]?.length ?? 0;
  if (params.channels.length === 0 || peaksCount <= 0) return new Float32Array();

  const startIndex = Math.max(0, Math.min(peaksCount, Math.floor(params.startIndex)));
  const endIndex = Math.max(startIndex, Math.min(peaksCount, Math.ceil(params.endIndex)));
  const sourceLength = endIndex - startIndex;
  if (sourceLength <= 0) return new Float32Array();

  const binCount = Math.max(1, Math.min(sourceLength, Math.floor(params.outputBins)));
  const gain = typeof params.gain === 'number' && Number.isFinite(params.gain) ? params.gain : 1;

  const mips = params.mips ?? getPeakMips(params.channels);
  const samplesPerBin = sourceLength / binCount;
  const level = selectMipLevel(mips, samplesPerBin);
  const levelChannels = mips.levels[level] ?? params.channels;
  const stride = 1 << level;

  // Translate the level-0 range into this level's coordinate space.
  const levelLength = levelChannels[0]?.length ?? 0;
  const lvStart = Math.min(levelLength, startIndex >> level);
  const lvEnd = Math.max(lvStart, Math.min(levelLength, Math.ceil(endIndex / stride)));
  const lvSourceLength = lvEnd - lvStart;
  if (lvSourceLength <= 0) return new Float32Array();

  const bins = new Float32Array(binCount);
  for (let binIndex = 0; binIndex < binCount; binIndex++) {
    const binStart = lvStart + Math.floor((binIndex * lvSourceLength) / binCount);
    const binEnd = Math.max(
      binStart + 1,
      lvStart + Math.ceil(((binIndex + 1) * lvSourceLength) / binCount),
    );

    let peak = 0;
    for (let sampleIndex = binStart; sampleIndex < binEnd; sampleIndex++) {
      for (let channelIndex = 0; channelIndex < levelChannels.length; channelIndex++) {
        const value = Math.abs(levelChannels[channelIndex]?.[sampleIndex] ?? 0);
        if (value > peak) peak = value;
      }
    }
    bins[binIndex] = peak * gain;
  }

  return bins;
}

/** Test-only: drops the memoized pyramids so each test starts from a clean cache. */
export function __resetPeakMipsCacheForTests(): void {
  mipCache = new WeakMap<readonly Float32Array[], PeakMips>();
}
