export const EQ_CANVAS_WIDTH = 720;
export const EQ_CANVAS_HEIGHT = 220;
export const EQ_MIN_FREQUENCY = 20;
export const EQ_MAX_FREQUENCY = 20000;
export const EQ_MIN_GAIN = -24;
export const EQ_MAX_GAIN = 24;
export const EQ_MIN_Q = 0.1;
export const EQ_MAX_Q = 20;
export const EQ_GAUSSIAN_BASE_WIDTH = 1.6;
export const EQ_GAUSSIAN_MIN_WIDTH = 0.12;
export const EQ_SHELF_STEEPNESS = 4;
export const EQ_LOWPASS_ATTENUATION_DB = -24;
export const EQ_BANDPASS_ATTENUATION_DB = -18;
export const EQ_NOTCH_ATTENUATION_DB = -24;

export interface ParametricEqPoint {
  enabled?: boolean;
  type?: BiquadFilterType;
  frequency?: number;
  q?: number;
  gain?: number;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function frequencyToX(frequency: number, canvasWidth: number = EQ_CANVAS_WIDTH) {
  const safeFrequency = clamp(frequency, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY);
  const ratio =
    (Math.log10(safeFrequency) - Math.log10(EQ_MIN_FREQUENCY)) /
    (Math.log10(EQ_MAX_FREQUENCY) - Math.log10(EQ_MIN_FREQUENCY));

  return ratio * canvasWidth;
}

export function gainToY(gain: number, canvasHeight: number = EQ_CANVAS_HEIGHT) {
  const ratio = (clamp(gain, EQ_MIN_GAIN, EQ_MAX_GAIN) - EQ_MIN_GAIN) / (EQ_MAX_GAIN - EQ_MIN_GAIN);

  return canvasHeight - ratio * canvasHeight;
}

export function getPointContribution(point: ParametricEqPoint, frequency: number) {
  if (!point.enabled) {
    return 0;
  }

  const pointFrequency = clamp(point.frequency ?? 1000, EQ_MIN_FREQUENCY, EQ_MAX_FREQUENCY);
  const normalizedQ = clamp(point.q ?? 1, EQ_MIN_Q, EQ_MAX_Q);
  const gain = clamp(point.gain ?? 0, EQ_MIN_GAIN, EQ_MAX_GAIN);
  const distance = Math.abs(Math.log2(frequency / pointFrequency));
  const gaussianWidth = Math.max(EQ_GAUSSIAN_MIN_WIDTH, EQ_GAUSSIAN_BASE_WIDTH / normalizedQ);
  const gaussian = Math.exp(-0.5 * (distance / gaussianWidth) ** 2);

  switch (point.type) {
    case 'peaking':
      return gain * gaussian;
    case 'lowshelf':
      return (
        gain /
        (1 +
          Math.exp(
            (distance * EQ_SHELF_STEEPNESS * Math.sign(frequency - pointFrequency)) / gaussianWidth,
          ))
      );
    case 'highshelf':
      return (
        gain /
        (1 +
          Math.exp(
            (distance * -EQ_SHELF_STEEPNESS * Math.sign(frequency - pointFrequency)) /
              gaussianWidth,
          ))
      );
    case 'lowpass':
      return frequency > pointFrequency
        ? EQ_LOWPASS_ATTENUATION_DB * (1 - Math.exp(-distance * normalizedQ))
        : 0;
    case 'highpass':
      return frequency < pointFrequency
        ? EQ_LOWPASS_ATTENUATION_DB * (1 - Math.exp(-distance * normalizedQ))
        : 0;
    case 'bandpass':
      return EQ_BANDPASS_ATTENUATION_DB * (1 - gaussian);
    case 'notch':
      return -Math.min(
        Math.abs(EQ_NOTCH_ATTENUATION_DB),
        Math.abs(EQ_NOTCH_ATTENUATION_DB) * gaussian,
      );
    case 'allpass':
    default:
      return 0;
  }
}

export interface DrawParametricEqOptions {
  canvas: HTMLCanvasElement;
  points: ParametricEqPoint[];
  canvasWidth?: number;
  canvasHeight?: number;
}

export function drawParametricEqVisualization(options: DrawParametricEqOptions) {
  const {
    canvas,
    points,
    canvasWidth = EQ_CANVAS_WIDTH,
    canvasHeight = EQ_CANVAS_HEIGHT,
  } = options;
  const context = canvas.getContext('2d');
  if (!context) {
    return;
  }

  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.fillStyle = '#0f172a';
  context.fillRect(0, 0, canvasWidth, canvasHeight);

  context.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  context.lineWidth = 1;

  const frequencyMarkers = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

  context.font = '10px monospace';
  context.textAlign = 'center';
  context.textBaseline = 'top';

  for (const marker of frequencyMarkers) {
    const x = frequencyToX(marker, canvasWidth);

    context.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, canvasHeight);
    context.stroke();

    context.fillStyle = 'rgba(148, 163, 184, 0.7)';
    const label = marker >= 1000 ? `${marker / 1000}k` : String(marker);
    context.fillText(label, x, canvasHeight - 16);
  }

  const gainMarkers = [-24, -12, 0, 12, 24];

  context.textAlign = 'right';
  context.textBaseline = 'middle';

  for (const marker of gainMarkers) {
    const y = gainToY(marker, canvasHeight);

    context.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(canvasWidth, y);
    context.stroke();

    if (marker !== 0) {
      context.fillStyle = 'rgba(148, 163, 184, 0.7)';
      context.fillText(`${marker > 0 ? '+' : ''}${marker}dB`, canvasWidth - 4, y);
    }
  }

  context.strokeStyle = 'rgba(45, 212, 191, 0.28)';
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(0, gainToY(0, canvasHeight));
  context.lineTo(canvasWidth, gainToY(0, canvasHeight));
  context.stroke();

  context.strokeStyle = '#2dd4bf';
  context.lineWidth = 2.5;
  context.beginPath();

  for (let x = 0; x <= canvasWidth; x += 1) {
    const frequency = 20 * 10 ** ((x / canvasWidth) * 3);
    const totalGain = clamp(
      points.reduce((sum, point) => sum + getPointContribution(point, frequency), 0),
      EQ_MIN_GAIN,
      EQ_MAX_GAIN,
    );
    const y = gainToY(totalGain, canvasHeight);

    if (x === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();

  for (const point of points) {
    if (!point.enabled) {
      continue;
    }

    const x = frequencyToX(point.frequency ?? 1000, canvasWidth);
    const y = gainToY(clamp(point.gain ?? 0, EQ_MIN_GAIN, EQ_MAX_GAIN), canvasHeight);

    context.fillStyle = '#22c55e';
    context.beginPath();
    context.arc(x, y, 4, 0, Math.PI * 2);
    context.fill();
  }
}
