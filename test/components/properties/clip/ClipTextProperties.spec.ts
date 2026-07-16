import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import ClipTextProperties from '~/components/properties/clip/ClipTextProperties.vue';
import { getFontStack } from '~/utils/video-editor/text-layout';

const mockAutoSize = { width: 123, height: 456 };

vi.mock('~/utils/video-editor/text-layout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/utils/video-editor/text-layout')>();
  return {
    ...actual,
    computeTextLayoutMetrics: vi.fn(() => ({
      frameWidth: mockAutoSize.width,
      frameHeight: mockAutoSize.height,
      renderScale: 1,
    })),
  };
});

const mockWorkspaceStore = {
  inDevelopmentFeaturesEnabled: true,
};

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

const baseClip = {
  id: 'clip-1',
  kind: 'clip',
  trackId: 'track-1',
  name: 'Text Clip',
  clipType: 'text',
  timelineRange: { startTicks: 0, durationTicks: 5_000_000 },
  sourceRange: { startTicks: 0, durationTicks: 5_000_000 },
  sourceDurationTicks: 5_000_000,
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

function stubs() {
  return {
    PropertySection: {
      template: '<div class="prop-section"><slot /></div>',
      props: ['title', 'enabled'],
      emits: ['update:enabled'],
    },
    PropertyField: {
      template: '<div class="prop-field" :data-label="label"><slot /></div>',
      props: ['label'],
    },
    UiWheelNumberInput: {
      template: '<input class="ui-number" :value="modelValue" />',
      props: ['modelValue'],
      emits: ['update:modelValue'],
    },
    UiSelect: {
      template:
        '<select class="ui-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item[valueKey || \'value\'] ?? item" :value="item[valueKey || \'value\'] ?? item">{{ item[labelKey || \'label\'] ?? item }}</option></select>',
      props: ['modelValue', 'items', 'valueKey', 'labelKey'],
      emits: ['update:modelValue'],
    },
    UiTextarea: { template: '<textarea class="ui-textarea"></textarea>' },
    UiColorBlendPicker: { template: '<div class="ui-color"></div>' },
    USwitch: {
      template:
        '<button class="u-switch" @click="$emit(\'update:modelValue\', !modelValue)"><slot /></button>',
      props: ['modelValue'],
      emits: ['update:modelValue'],
    },
    UButton: {
      template:
        '<button class="u-button" :data-icon="icon" @click="$emit(\'click\', $event)"><slot /></button>',
      props: ['icon'],
      emits: ['click'],
    },
  };
}

async function mountComponent(
  options: {
    clip?: ReturnType<typeof createClip>;
    presets?: Array<{ label: string; value: string }>;
    hidePresets?: boolean;
  } = {},
) {
  return mountSuspended(ClipTextProperties, {
    props: {
      clip: options.clip ?? createClip(),
      presets: options.presets ?? [],
      hidePresets: options.hidePresets ?? true,
    },
    global: { stubs: stubs() },
  });
}

describe('ClipTextProperties.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows align field only when width is manual', async () => {
    const wrapper = await mountComponent({ clip: createClip({ style: { width: undefined } }) });

    const fields = wrapper.findAll('.prop-field');
    const alignLabels = fields.filter((f) => f.attributes('data-label')?.includes('align'));
    expect(alignLabels.length).toBe(0);
  });

  it('renders lineHeight and letterSpacing in the same row', async () => {
    const wrapper = await mountComponent();

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
    const wrapper = await mountComponent({ clip });

    const switches = wrapper.findAll('.u-switch');
    // First switch is auto-width
    await switches[0]?.trigger('click');

    const emitted = wrapper.emitted('updateTextStyle');
    expect(emitted).toBeTruthy();
    const lastPayload = emitted![emitted!.length - 1] as any;
    expect(lastPayload[0]).toEqual({ width: mockAutoSize.width });
  });

  it('emits updateSnapToPixelGrid when the snap toggle is clicked', async () => {
    const wrapper = await mountComponent({ clip: createClip({ snapToPixelGrid: true }) });

    const switches = wrapper.findAll('.u-switch');
    const snapSwitch = switches[switches.length - 1];
    expect(snapSwitch).toBeTruthy();
    await snapSwitch.trigger('click');

    expect(wrapper.emitted('updateSnapToPixelGrid')).toBeTruthy();
    expect(wrapper.emitted('updateSnapToPixelGrid')?.at(-1)?.[0]).toBe(false);
  });

  it('emits paddingLinked=false when the padding link toggle is clicked', async () => {
    const wrapper = await mountComponent({
      clip: createClip({
        style: {
          backgroundEnabled: true,
          padding: { top: 12, right: 24, bottom: 12, left: 24 },
          paddingLinked: true,
        },
      }),
    });

    const linkButton = wrapper.find('[data-icon="i-heroicons-link"]');
    await linkButton.trigger('click');

    const emitted = wrapper.emitted('updateTextStyle');
    expect(emitted?.at(-1)?.[0]).toEqual({ paddingLinked: false });
  });

  it('emits a font selection that normalizes through getFontStack', async () => {
    const wrapper = await mountComponent();
    const fontSelect = wrapper.findAll('.ui-select')[0]!;

    await fontSelect.setValue('Arial Black');

    const emitted = wrapper.emitted('updateTextStyle');
    expect(emitted?.at(-1)?.[0]).toEqual({ fontFamily: 'Arial Black' });
    expect(getFontStack('Arial Black')).toBe('"Arial Black", "Arial Bold", sans-serif');
  });
});
