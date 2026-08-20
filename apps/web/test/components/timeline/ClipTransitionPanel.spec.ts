import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { ref, reactive } from 'vue';
import ClipTransitionPanel from '~/components/timeline/ClipTransitionPanel.vue';

// Mock components
vi.mock('~/components/ui/UiSliderInput.vue', () => ({
  default: { template: '<div class="mock-slider"></div>', props: ['modelValue'] },
}));
vi.mock('~/components/ui/UiButtonGroup.vue', () => ({
  default: {
    template: `
      <div class="mock-btn-group">
        <button
          v-for="option in options"
          :key="option.value"
          type="button"
          :disabled="option.disabled"
        >
          {{ option.value }}
        </button>
      </div>
    `,
    props: ['modelValue', 'options'],
  },
}));
vi.mock('~/components/ui/UiSelect.vue', () => ({
  default: {
    template: `
      <div class="mock-select">
        <span class="select-value">{{ modelValue }}</span>
        <span class="select-leading"><slot name="leading" /></span>
        <span class="select-options">
          <span
            v-for="item in items"
            :key="item.value"
            class="select-option"
            :class="{ disabled: item.disabled }"
          >
            <span class="option-leading"><slot name="item-leading" :item="item" /></span>
            <span class="option-label">{{ item.label }}</span>
          </span>
        </span>
      </div>
    `,
    props: ['modelValue', 'items'],
  },
}));
vi.mock('~/components/ui/UiModal.vue', () => ({
  default: {
    template: '<div class="mock-modal"><slot name="body" /><slot /></div>',
    props: ['open', 'title'],
  },
}));
vi.mock('~/components/properties/TransitionParamFields.vue', () => ({
  default: { template: '<div class="mock-params"></div>' },
}));

vi.mock('~/transitions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/transitions')>();

  return {
    ...actual,
    getAllTransitionManifests: () => [
      {
        type: 'dissolve',
        name: 'Dissolve',
        icon: 'i-heroicons-arrows-right-left',
        supportedModes: ['adjacent', 'background', 'transparent'],
      },
      {
        type: 'wipe',
        name: 'Wipe',
        icon: 'i-heroicons-arrow-long-right',
        supportedModes: ['adjacent'],
      },
      {
        type: 'motion-blur',
        name: 'Motion Blur',
        icon: 'i-heroicons-forward',
        supportedModes: ['adjacent', 'background', 'transparent'],
        experimental: true,
      },
    ],
  };
});

// Mock Composables
vi.mock('~/composables/timeline/useClipTransitionPanel', () => ({
  useClipTransitionPanel: () => ({
    durationMax: ref(2),
    durationMin: ref(0.1),
    durationSec: ref(1),
    durationStep: ref(0.1),
    edgeIcon: ref('i-heroicons-arrow-right-circle'),
    remove: vi.fn(),
    selectedCurve: ref('linear'),
    selectedManifest: ref({
      paramFields: [],
      supportedModes: ['adjacent', 'background', 'transparent'],
    }),
    selectedMode: ref('adjacent'),
    selectedParams: ref({}),
    selectedType: ref('wipe'),
    updateParam: vi.fn(),
  }),
}));

const mockPresetsStore = {
  saveAsPreset: vi.fn(),
};

vi.mock('~/stores/presets.store', () => ({
  usePresetsStore: () => mockPresetsStore,
}));

const mockWorkspaceStore = reactive({
  inDevelopmentFeaturesEnabled: false,
});

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: () => mockWorkspaceStore,
}));

describe('ClipTransitionPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;
  });

  const defaultProps = {
    edge: 'in' as const,
    trackId: 'track-1',
    itemId: 'clip-1',
    transition: {
      type: 'dissolve',
      durationTicks: 1000000,
      curve: 'linear',
      mode: 'adjacent',
    } as any,
  };

  it('renders correctly', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;
    const component = await mountSuspended(ClipTransitionPanel, { props: defaultProps });

    expect(component.text()).toContain('IN');
    // Fastcat translation keys
    expect(component.text()).toContain('fastcat.timeline.transition.title');

    // Check if slider and button groups are rendered
    expect(component.find('.mock-slider').exists()).toBe(true);
    expect(component.findAll('.mock-btn-group').length).toBe(2); // Mode and Curve
  });

  it('can open save preset modal', async () => {
    const component = await mountSuspended(ClipTransitionPanel, { props: defaultProps });

    // The button that opens modal has the bookmark icon
    const buttons = component.findAll('button');
    const saveBtn = buttons.find(
      (b) =>
        b.html().includes('i-heroicons-bookmark') || b.attributes('title') === 'Save as preset',
    );
    await saveBtn!.trigger('click');

    const modal = component.find('.mock-modal');
    expect(modal.exists()).toBe(true);
  });

  it('enables all supported transition source modes', async () => {
    const component = await mountSuspended(ClipTransitionPanel, { props: defaultProps });

    const buttons = component.findAll('.mock-btn-group button');
    const adjacent = buttons.find((button) => button.text() === 'adjacent');
    const background = buttons.find((button) => button.text() === 'background');
    const transparent = buttons.find((button) => button.text() === 'transparent');

    expect(adjacent?.attributes('disabled')).toBeUndefined();
    expect(background?.attributes('disabled')).toBeUndefined();
    expect(transparent?.attributes('disabled')).toBeUndefined();
  });

  it('renders transition type options as a dropdown with icons and disabled state', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;
    const component = await mountSuspended(ClipTransitionPanel, { props: defaultProps });

    const options = component.findAll('.select-option');
    expect(options.length).toBe(2);

    expect(options[0].find('.option-label').text()).toBe('Dissolve');
    expect(options[0].find('.option-leading .icon-mock').exists()).toBe(true);
    expect(options[0].classes()).not.toContain('disabled');

    expect(options[1].find('.option-label').text()).toBe('Wipe');
    expect(options[1].find('.option-leading .icon-mock').exists()).toBe(true);
    expect(options[1].classes()).not.toContain('disabled');
  });

  it('hides experimental transitions when inDevelopmentFeaturesEnabled is false', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = false;
    const component = await mountSuspended(ClipTransitionPanel, { props: defaultProps });

    const options = component.findAll('.select-option');
    const labels = options.map((o) => o.find('.option-label').text());
    expect(labels).not.toContain('Motion Blur');
  });

  it('shows experimental transitions when inDevelopmentFeaturesEnabled is true', async () => {
    mockWorkspaceStore.inDevelopmentFeaturesEnabled = true;
    const component = await mountSuspended(ClipTransitionPanel, { props: defaultProps });

    const options = component.findAll('.select-option');
    const labels = options.map((o) => o.find('.option-label').text());
    expect(labels).toContain('Motion Blur');
  });
});
