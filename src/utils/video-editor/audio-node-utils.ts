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

export interface StopNodeCollectionOptions {
  audioContext?: AudioContext | null;
  fadeOutS?: number;
  gains?: Map<AudioBufferSourceNode, GainNode>;
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
  cleanups: Map<AudioBufferSourceNode, () => void | Promise<void>>,
  options: StopNodeCollectionOptions = {},
) {
  const fadeOutS = Math.max(0, options.fadeOutS ?? 0);
  const stopAtS =
    options.audioContext && fadeOutS > 0 ? options.audioContext.currentTime + fadeOutS : 0;
  const pendingStops: Array<{
    node: AudioBufferSourceNode;
    cleanup?: () => void | Promise<void>;
  }> = [];

  for (const node of nodes) {
    const cleanup = cleanups.get(node);

    if (stopAtS > 0) {
      const gain = options.gains?.get(node);
      if (gain) {
        const gainParam = gain.gain;
        try {
          if (typeof gainParam.cancelAndHoldAtTime === 'function') {
            gainParam.cancelAndHoldAtTime(options.audioContext?.currentTime ?? 0);
          } else {
            gainParam.cancelScheduledValues?.(options.audioContext?.currentTime ?? 0);
            gainParam.setValueAtTime?.(gainParam.value, options.audioContext?.currentTime ?? 0);
          }
          gainParam.linearRampToValueAtTime?.(0, stopAtS);
        } catch {
          /* no-op */
        }
      }
      try {
        node.stop(stopAtS);
      } catch {
        /* no-op */
      }
      pendingStops.push({ node, cleanup });
      continue;
    }

    stopNode(node, cleanup);
  }

  nodes.clear();
  cleanups.clear();
  options.gains?.clear();

  if (pendingStops.length === 0 || stopAtS <= 0) {
    return;
  }

  globalThis.setTimeout(() => {
    for (const pending of pendingStops) {
      cleanupNode(pending.node, pending.cleanup);
    }
  }, fadeOutS * 1000);
}

function stopNode(node: AudioBufferSourceNode, cleanup?: () => void | Promise<void>) {
  try {
    node.stop();
    node.disconnect();
  } catch {
    /* no-op */
  }

  if (!cleanup) {
    return;
  }

  runCleanup(cleanup);
}

function cleanupNode(node: AudioBufferSourceNode, cleanup?: () => void | Promise<void>) {
  try {
    node.disconnect();
  } catch {
    /* no-op */
  }

  if (!cleanup) {
    return;
  }

  runCleanup(cleanup);
}

function runCleanup(cleanup: () => void | Promise<void>) {
  try {
    const res = cleanup();
    if (res instanceof Promise) {
      res.catch(() => {
        /* no-op */
      });
    }
  } catch {
    /* no-op */
  }
}
