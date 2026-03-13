import type {
  AudioEffectManifest,
  AudioEffectContext,
  AudioEffectNodeGraph,
} from '../../core/registry';

export interface ParametricEqPoint {
  id: string;
  enabled: boolean;
  type: BiquadFilterType;
  frequency: number;
  q: number;
  gain: number;
}

export interface ParametricEqParams {
  points: ParametricEqPoint[];
}

interface EqNodeGraph extends AudioEffectNodeGraph {
  input: GainNode;
  output: GainNode;
  filters: BiquadFilterNode[];
}

const FILTER_TYPES: { label: string; value: BiquadFilterType }[] = [
  { label: 'Low Pass', value: 'lowpass' },
  { label: 'High Pass', value: 'highpass' },
  { label: 'Band Pass', value: 'bandpass' },
  { label: 'Low Shelf', value: 'lowshelf' },
  { label: 'High Shelf', value: 'highshelf' },
  { label: 'Peaking (Bell)', value: 'peaking' },
  { label: 'Notch', value: 'notch' },
  { label: 'All Pass', value: 'allpass' },
];

export const parametricEqManifest: AudioEffectManifest<ParametricEqParams> = {
  type: 'audio-parametric-eq',
  name: 'Parametric EQ',
  description: 'Professional multi-band parametric equalizer',
  icon: 'i-heroicons-adjustments-vertical',
  target: 'audio',
  disableGlobalWet: true, // EQ shouldn't be phased by global wet/dry mix
  defaultValues: {
    points: [
      {
        id: 'p1',
        enabled: true,
        type: 'highpass',
        frequency: 80,
        q: 0.707,
        gain: 0,
      },
      {
        id: 'p2',
        enabled: true,
        type: 'peaking',
        frequency: 1000,
        q: 1,
        gain: 0,
      },
      {
        id: 'p3',
        enabled: true,
        type: 'lowshelf',
        frequency: 10000,
        q: 0.707,
        gain: 0,
      },
    ],
  },
  controls: [
    {
      kind: 'action',
      key: 'openSettings',
      action: 'open-settings',
      buttonLabel: 'Open Equalizer Settings',
      icon: 'i-heroicons-adjustments-vertical',
    },
  ],
  settingsControls: [
    {
      kind: 'array',
      key: 'points',
      layout: 'horizontal',
      addLabel: 'Add EQ Band',
      emptyLabel: 'No EQ bands added',
      defaultItem: {
        id: '', // Will be generated or can just rely on index
        enabled: true,
        type: 'peaking',
        frequency: 1000,
        q: 1,
        gain: 0,
      },
      itemTemplate: [
        {
          kind: 'row',
          columns: 1,
          controls: [
            {
              kind: 'toggle',
              key: 'enabled',
              label: 'Enabled',
            },
            {
              kind: 'select',
              key: 'type',
              label: 'Filter Type',
              options: FILTER_TYPES,
            },
          ],
        },
        {
          kind: 'knob',
          key: 'frequency',
          label: 'Freq',
          min: 20,
          max: 20000,
          step: 1,
          format: (v) => `${Math.round(v)} Hz`,
        },
        {
          kind: 'knob',
          key: 'gain',
          label: 'Gain',
          min: -24,
          max: 24,
          step: 0.1,
          format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
          showIf: (v) => ['lowshelf', 'highshelf', 'peaking'].includes(v.type),
        },
        {
          kind: 'knob',
          key: 'q',
          label: 'Q',
          min: 0.1,
          max: 20,
          step: 0.01,
          format: (v) => v.toFixed(2),
          showIf: (v) =>
            ['lowpass', 'highpass', 'bandpass', 'peaking', 'notch', 'allpass'].includes(v.type),
        },
      ],
    },
  ],
  createNode(context: AudioEffectContext): EqNodeGraph {
    const input = context.audioContext.createGain();
    const output = context.audioContext.createGain();
    const filters: BiquadFilterNode[] = [];

    // Pre-allocate 10 filters connected in series to avoid clicks/glitches during real-time updates
    let current: AudioNode = input;
    for (let i = 0; i < 10; i++) {
      const filter = context.audioContext.createBiquadFilter();
      // Peaking with 0 gain is completely transparent
      filter.type = 'peaking';
      filter.gain.value = 0;
      current.connect(filter);
      current = filter;
      filters.push(filter);
    }
    current.connect(output);

    return { input, output, filters };
  },
  updateNode(node, values, context) {
    const graph = node as EqNodeGraph;
    const points = values.points || [];

    let activeIndex = 0;

    // Update active filters
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (!point || !point.enabled) continue;

      if (activeIndex >= graph.filters.length) break; // Max 10 points supported

      const filter = graph.filters[activeIndex];
      if (!filter) continue;

      filter.type = point.type || 'peaking';

      const freq = Math.max(20, Math.min(20000, point.frequency || 1000));
      const q = Math.max(0.0001, Math.min(1000, point.q || 1));
      const gain = Math.max(-40, Math.min(40, point.gain || 0));

      const time = context.audioContext.currentTime;
      // Use setTargetAtTime with a small time constant (0.02s) to prevent zipper noise when adjusting knobs
      filter.frequency.setTargetAtTime(freq, time, 0.02);
      filter.Q.setTargetAtTime(q, time, 0.02);
      filter.gain.setTargetAtTime(gain, time, 0.02);

      activeIndex++;
    }

    // Reset unused filters to transparent
    for (let i = activeIndex; i < graph.filters.length; i++) {
      const filter = graph.filters[i];
      if (!filter) continue;

      filter.type = 'peaking';
      const time = context.audioContext.currentTime;
      filter.gain.setTargetAtTime(0, time, 0.02);
    }
  },
};
