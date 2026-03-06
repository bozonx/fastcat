export const MIN_TIMELINE_ZOOM_POSITION = 0;
export const MAX_TIMELINE_ZOOM_POSITION = 110;
export const DEFAULT_TIMELINE_ZOOM_POSITION = 50;

export const MIN_MONITOR_ZOOM = 0.05;
export const MAX_MONITOR_ZOOM = 20;
export const DEFAULT_MONITOR_ZOOM = 1;

const EPSILON = 1e-6;

function roundZoomValue(value: number): number {
  return Number(value.toFixed(4));
}

function pushZoomRange(values: number[], start: number, end: number, step: number) {
  for (let current = start; current <= end + EPSILON; current += step) {
    values.push(roundZoomValue(current));
  }
}

function createNiceZoomLevels(maxZoom: number): number[] {
  const values: number[] = [];

  pushZoomRange(values, 0.05, Math.min(maxZoom, 0.2), 0.025);
  if (maxZoom > 0.2) pushZoomRange(values, 0.25, Math.min(maxZoom, 0.5), 0.05);
  if (maxZoom > 0.5) pushZoomRange(values, 0.55, Math.min(maxZoom, 1.5), 0.05);
  if (maxZoom > 1.5) pushZoomRange(values, 1.6, Math.min(maxZoom, 3), 0.1);
  if (maxZoom > 3) pushZoomRange(values, 3.25, Math.min(maxZoom, 6), 0.25);
  if (maxZoom > 6) pushZoomRange(values, 6.5, Math.min(maxZoom, 10), 0.5);
  if (maxZoom > 10) pushZoomRange(values, 11, Math.min(maxZoom, 20), 1);
  if (maxZoom > 20) pushZoomRange(values, 22, Math.min(maxZoom, 50), 2);
  if (maxZoom > 50) pushZoomRange(values, 55, Math.min(maxZoom, 100), 5);
  if (maxZoom > 100) pushZoomRange(values, 110, Math.min(maxZoom, 200), 10);
  if (maxZoom > 200) pushZoomRange(values, 225, Math.min(maxZoom, 400), 25);

  values.push(DEFAULT_MONITOR_ZOOM);
  values.push(maxZoom);

  return [...new Set(values)]
    .filter((value) => value >= MIN_MONITOR_ZOOM - EPSILON && value <= maxZoom + EPSILON)
    .sort((a, b) => a - b);
}

export const MONITOR_ZOOM_LEVELS = createNiceZoomLevels(MAX_MONITOR_ZOOM);
const TIMELINE_ZOOM_SCALE_LEVELS = createNiceZoomLevels(400);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getFirstStep(steps: number[], fallback: number): number {
  return steps[0] ?? fallback;
}

function getLastStep(steps: number[], fallback: number): number {
  return steps[steps.length - 1] ?? fallback;
}

export function timelineZoomPositionToScale(position: number): number {
  const safePosition = clamp(position, MIN_TIMELINE_ZOOM_POSITION, MAX_TIMELINE_ZOOM_POSITION);
  const exponent = (safePosition - DEFAULT_TIMELINE_ZOOM_POSITION) / 7;
  return 2 ** exponent;
}

export function timelineZoomScaleToPosition(scale: number): number {
  const safeScale = clamp(
    scale,
    timelineZoomPositionToScale(MIN_TIMELINE_ZOOM_POSITION),
    timelineZoomPositionToScale(MAX_TIMELINE_ZOOM_POSITION),
  );
  const position = DEFAULT_TIMELINE_ZOOM_POSITION + 7 * Math.log2(safeScale);
  return clamp(position, MIN_TIMELINE_ZOOM_POSITION, MAX_TIMELINE_ZOOM_POSITION);
}

export const TIMELINE_ZOOM_POSITIONS = TIMELINE_ZOOM_SCALE_LEVELS.map((scale) =>
  timelineZoomScaleToPosition(scale),
);

export function snapValueToNearestStep(value: number, steps: number[]): number {
  if (!Number.isFinite(value) || steps.length === 0) return value;

  let nearest = getFirstStep(steps, value);
  let nearestDistance = Math.abs(value - nearest);

  for (const step of steps) {
    const distance = Math.abs(value - step);
    if (distance < nearestDistance) {
      nearest = step;
      nearestDistance = distance;
    }
  }

  return nearest;
}

export function getSteppedValue(params: {
  value: number;
  direction: 1 | -1;
  steps: number[];
}): number {
  const { value, direction, steps } = params;
  if (!Number.isFinite(value) || steps.length === 0) return value;

  if (direction > 0) {
    for (const step of steps) {
      if (step > value + EPSILON) return step;
    }

    return getLastStep(steps, value);
  }

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step !== undefined && step < value - EPSILON) return step;
  }

  return getFirstStep(steps, value);
}

export function snapTimelineZoomPosition(position: number): number {
  return snapValueToNearestStep(position, TIMELINE_ZOOM_POSITIONS);
}

export function stepTimelineZoomPosition(currentPosition: number, direction: 1 | -1): number {
  const currentScale = timelineZoomPositionToScale(currentPosition);
  const nextScale = getSteppedValue({
    value: currentScale,
    direction,
    steps: TIMELINE_ZOOM_SCALE_LEVELS,
  });
  return timelineZoomScaleToPosition(nextScale);
}

export function snapMonitorZoom(value: number): number {
  return snapValueToNearestStep(
    clamp(value, MIN_MONITOR_ZOOM, MAX_MONITOR_ZOOM),
    MONITOR_ZOOM_LEVELS,
  );
}

export function stepMonitorZoom(currentValue: number, direction: 1 | -1): number {
  return getSteppedValue({
    value: clamp(currentValue, MIN_MONITOR_ZOOM, MAX_MONITOR_ZOOM),
    direction,
    steps: MONITOR_ZOOM_LEVELS,
  });
}

export function formatZoomMultiplier(value: number): string {
  const safeValue = Number.isFinite(value) ? value : DEFAULT_MONITOR_ZOOM;
  const decimals = safeValue >= 10 ? 0 : safeValue >= 1 ? 2 : 3;
  return `x${safeValue
    .toFixed(decimals)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1')}`;
}
