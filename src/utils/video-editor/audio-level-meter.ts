/**
 * Owns the per-track + master `AnalyserNode`s used for RMS/peak level metering
 * in {@link WebAudioEngine}. Extracted so the engine doesn't also have to carry
 * the analyser map lifecycle and the time-domain math. The engine wires the
 * master analyser it gets from {@link createMasterAnalyser} into its output
 * chain, and hands {@link analyserNodes} to the graph builder so per-clip
 * graphs can register their track analysers.
 */
export class AudioLevelMeter {
  // map keyed by trackId, plus the special 'master' bus
  readonly analyserNodes = new Map<string, AnalyserNode>();
  private readonly analyserData = new Float32Array(2048);

  /**
   * Creates the master-bus analyser, registers it under the `'master'` key and
   * returns it so the caller can splice it into the output graph. Matches the
   * previous inline behaviour (fftSize 2048).
   */
  createMasterAnalyser(ctx: AudioContext): AnalyserNode {
    const masterAnalyser = ctx.createAnalyser();
    masterAnalyser.fftSize = 2048;
    this.analyserNodes.set('master', masterAnalyser);
    return masterAnalyser;
  }

  /**
   * RMS/peak in dBFS for a track (or the master bus when `trackId` is omitted).
   * Returns the -60 dB floor when the engine isn't actively playing or the
   * analyser is missing. `active` is supplied by the caller (engine has a
   * context and the scheduler is playing).
   */
  getLevels(trackId: string | undefined, active: boolean): { rmsDb: number; peakDb: number } {
    if (!active) return { rmsDb: -60, peakDb: -60 };

    const id = trackId || 'master';
    const analyser = this.analyserNodes.get(id);
    if (!analyser) {
      return { rmsDb: -60, peakDb: -60 };
    }

    analyser.getFloatTimeDomainData(this.analyserData);

    let sumSquares = 0;
    let peak = 0;
    let count = 0;
    const len = this.analyserData.length;
    for (let i = 0; i < len; i++) {
      const val = this.analyserData[i];
      if (val === undefined || !Number.isFinite(val)) continue;
      const abs = Math.abs(val);
      sumSquares += abs * abs;
      if (abs > peak) peak = abs;
      count += 1;
    }

    const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;

    return {
      rmsDb: rms > 0.001 ? 20 * Math.log10(rms) : -60,
      peakDb: peak > 0.001 ? 20 * Math.log10(peak) : -60,
    };
  }

  /**
   * Disconnects and drops analysers whose track is no longer present. The
   * master analyser is always retained.
   */
  cleanup(activeTrackIds: Set<string>): void {
    for (const [id, analyser] of this.analyserNodes) {
      if (id === 'master' || activeTrackIds.has(id)) continue;
      try {
        analyser.disconnect();
      } catch {
        /* no-op */
      }
      this.analyserNodes.delete(id);
    }
  }

  /** Drops all analyser references (engine teardown). */
  clear(): void {
    this.analyserNodes.clear();
  }
}
