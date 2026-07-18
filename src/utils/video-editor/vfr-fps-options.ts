import {
  STANDARD_FRAME_RATES,
  frameRateToNumber,
  sanitizeFrameRate,
  type FrameRate,
} from '~/utils/time/ticks';

export interface VfrFrameRateOption {
  /** Exact fps value (e.g. 29.97002997…) to apply to the timeline / conform to. */
  value: number;
  /** Human label (e.g. "29.97", "30", "60"). */
  label: string;
  /** The frame rate this VFR source averages to (pre-selected in the picker). */
  isDetected: boolean;
}

/** The common editing rates offered alongside the detected average, in ascending
 * order. Broadcast fractional twins (23.976, 29.97, 59.94) are represented by their
 * `STANDARD_FRAME_RATES` entries so the applied value is exact, not a rounded float. */
const COMMON_FRAME_RATE_LABELS = ['24', '25', '30', '50', '60'] as const;

function standardByLabel(label: string): FrameRate | null {
  const found = STANDARD_FRAME_RATES.find((r) => r.label === label);
  return found ? { num: found.num, den: found.den } : null;
}

/**
 * Builds the frame-rate choices offered when the user resolves a VFR source: the
 * detected average (snapped to the nearest standard rate so its label/value are
 * clean) plus the common editing rates, de-duplicated and sorted ascending. The
 * detected option is flagged so the picker can pre-select it. This is the shared
 * source of truth for both the C2 "pick a timeline fps" flow and the C1 conform
 * target — offering a rate at or above the source's motion peak (e.g. 60) lets a
 * conform preserve every captured frame via duplication rather than dropping any.
 */
export function buildVfrFrameRateOptions(detectedFps: number): VfrFrameRateOption[] {
  const detectedRate = sanitizeFrameRate(detectedFps);
  const detectedValue = frameRateToNumber(detectedRate);
  const detectedLabel = formatFrameRateLabel(detectedValue);

  // Key by rounded value so the detected average and a common rate it snapped to
  // (e.g. a source measured at 29.98 → "30") collapse into a single option.
  const byKey = new Map<string, VfrFrameRateOption>();
  const keyOf = (value: number) => (Math.round(value * 1000) / 1000).toFixed(3);

  const push = (value: number, label: string, isDetected: boolean) => {
    if (!(Number.isFinite(value) && value > 0)) return;
    const key = keyOf(value);
    const existing = byKey.get(key);
    if (existing) {
      // A later duplicate never demotes the detected flag; it may set it.
      existing.isDetected = existing.isDetected || isDetected;
      return;
    }
    byKey.set(key, { value, label, isDetected });
  };

  if (detectedValue > 0) {
    push(detectedValue, detectedLabel, true);
  }
  for (const label of COMMON_FRAME_RATE_LABELS) {
    const rate = standardByLabel(label);
    if (rate) push(frameRateToNumber(rate), label, false);
  }

  return Array.from(byKey.values()).sort((a, b) => a.value - b.value);
}

/** A concise label for an fps value: broadcast fractional rates keep 3 decimals
 * (23.976 / 29.97 / 59.94), integer rates show no decimals. */
export function formatFrameRateLabel(value: number): string {
  if (!(Number.isFinite(value) && value > 0)) return '';
  if (Math.abs(value - Math.round(value)) < 1e-3) return String(Math.round(value));
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
