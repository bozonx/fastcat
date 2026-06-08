import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipTextProperties from '~/components/properties/clip/ClipTextProperties.vue';

const mockAutoSize = { width: 123, height: 456 };

vi.mock('~/utils/video-editor/text-layout', () => ({
  computeTextLayoutMetrics: vi.fn(() => ({
    frameWidth: mockAutoSize.width,
    frameHeight: mockAutoSize.height,
    renderScale: 1,
  })),
}));

const baseClip = {
  id: 'clip-1',
  kind: 'clip',
  trackId: 'track-1',
  name: 'Text Clip',
  clipType: 'text',
  timelineRange: { startUs: 0, durationUs: 5_000_000 },
  sourceRange: { startUs: 0, durationUs: 5_000_000 },
  sourceDurationUs: 5_000_000,
  text: 'Hello world',
  style: {
    fontSize: 64,
    fontFamily: 'sans-serif',
    color: '#ffffff',
    colorAlpha: 1,
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    letterSpacing: 0,
    padding: { top: 60, right: 60, bottom: 60, left: 60 },
    paddingLinked: true,
  },
};

function createClip(overrides: Record<string, unknown> = {}) {
  return {
    ...baseClip,
    style: { ...baseClip.style, ...(overrides.style as Record<string, unknown> | undefined) },
    ...overrides,
  };
}

describe('ClipTextProperties.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows align field only when width is manual', async () => {
    const wrapper = await mountSuspended(ClipTextProperties, {
      props: {
        clip: createClip({ style: { width: undefined } }),
        presets: [],
        hidePresets: true,
      },
      global: {
        stubs: {
          PropertySection: { template: '<div class="prop-section"><slot /></div>' },
          PropertyField: {
            template: '<div class="prop-field" :data-label="label"><slot /></div>',
            props: ['label'],
          },
          UiWheelNumberInput: { template: '<input class="ui-number" />' },
          UiSelect: { template: '<select class="ui-select"><option>opt</option></select>' },
          UiTextarea: { template: '<textarea class="ui-textarea"></textarea>' },
          UiColorBlendPicker: { template: '<div class="ui-color"></div>' },
          USwitch: {
            template: '<button class="u-switch" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
            props: ['modelValue'],
          },
          UButton: { template: '<button class="u-button"><slot /></button>' },
        },
      },
    });

    const fields = wrapper.findAll('.prop-field');
    const alignLabels = fields.filter((f) => f.attributes('data-label')?.includes('align'));
    expect(alignLabels.length).toBe(0);
  });

  it('renders lineHeight and letterSpacing in the same row', async () => {
    const wrapper = await mountSuspended(ClipTextProperties, {
      props: {
        clip: createClip(),
        presets: [],
        hidePresets: true,
      },
      global: {
        stubs: {
          PropertySection: { template: '<div class="prop-section"><slot /></div>' },
          PropertyField: {
            template: '<div class="prop-field" :data-label="label"><slot /></div>',
            props: ['label'],
          },
          UiWheelNumberInput: { template: '<input class="ui-number" />' },
          UiSelect: { template: '<select class="ui-select"><option>opt</option></select>' },
          UiTextarea: { template: '<textarea class="ui-textarea"></textarea>' },
          UiColorBlendPicker: { template: '<div class="ui-color"></div>' },
          USwitch: {
            template: '<button class="u-switch" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
            props: ['modelValue'],
          },
          UButton: { template: '<button class="u-button"><slot /></button>' },
        },
      },
    });

    const grids = wrapper.findAll('.grid-cols-2');
    let foundRow = false;
    for (const grid of grids) {
      const fields = grid.findAll('.prop-field');
      const labels = fields.map((f) => f.attributes('data-label'));
      if (
        labels.some((l) => l?.includes('lineHeight')) &&
        labels.some((l) => l?.includes('letterSpacing'))
      ) {
        foundRow = true;
        break;
      }
    }
    expect(foundRow).toBe(true);
  });

  it('emits current auto width when turning off auto-width', async () => {
    const clip = createClip({ style: { width: undefined } });
    const wrapper = await mountSuspended(ClipTextProperties, {
      props: {
        clip,
        presets: [],
        hidePresets: true,
      },
      global: {
        stubs: {
          PropertySection: { template: '<div class="prop-section"><slot /></div>' },
          PropertyField: {
            template: '<div class="prop-field" :data-label="label"><slot /></div>',
            props: ['label'],
          },
          UiWheelNumberInput: { template: '<input class="ui-number" />' },
          UiSelect: { template: '<select class="ui-select"><option>opt</option></select>' },
          UiTextarea: { template: '<textarea class="ui-textarea"></textarea>' },
          UiColorBlendPicker: { template: '<div class="ui-color"></div>' },
          USwitch: {
            template: '<button class="u-switch" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
            props: ['modelValue'],
          },
          UButton: { template: '<button class="u-button"><slot /></button>' },
        },
      },
    });

    const switches = wrapper.findAll('.u-switch');
    // First switch is auto-width
    await switches[0]?.trigger('click');

    const emitted = wrapper.emitted('updateTextStyle');
    expect(emitted).toBeTruthy();
    const lastPayload = emitted![emitted!.length - 1] as any;
    expect(lastPayload[0]).toEqual({ width: mockAutoSize.width });
  });
});
