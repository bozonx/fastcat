export interface ScheduleGainCurveParams {
  gainParam: AudioParam & {
    setValueCurveAtTime?: (values: Float32Array, startTime: number, duration: number) => AudioParam;
    linearRampToValueAtTime?: (value: number, endTime: number) => AudioParam;
  };
  startClipS: number;
  endClipS: number;
  startAtS: number;
  endAtS: number;
  getGainAtClipTime: (clipTimeS: number) => number;
}

export function scheduleGainCurve(params: ScheduleGainCurveParams) {
  const durationS = params.endAtS - params.startAtS;
  const clipDurationS = params.endClipS - params.startClipS;
  if (durationS <= 0 || clipDurationS <= 0) return;

  if (typeof params.gainParam.setValueCurveAtTime !== 'function') {
    params.gainParam.linearRampToValueAtTime?.(
      params.getGainAtClipTime(params.endClipS),
      params.endAtS,
    );
    return;
  }

  const steps = 64;
  const values = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const progress = steps <= 1 ? 1 : i / (steps - 1);
    values[i] = params.getGainAtClipTime(params.startClipS + clipDurationS * progress);
  }

  params.gainParam.setValueCurveAtTime(values, params.startAtS, durationS);
}

export function stopNodeCollection(
  nodes: Set<AudioBufferSourceNode>,
  cleanups: Map<AudioBufferSourceNode, () => void>,
) {
  for (const node of nodes) {
    try {
      node.stop();
      node.disconnect();
    } catch {
      /* no-op */
    }

    const cleanup = cleanups.get(node);
    if (cleanup) {
      try {
        cleanup();
      } catch {
        /* no-op */
      }
      cleanups.delete(node);
    }
  }
  nodes.clear();
  cleanups.clear();
}
