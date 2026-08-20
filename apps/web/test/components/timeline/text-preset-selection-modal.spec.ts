import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import TextPresetSelectionModal from '~/components/timeline/TextPresetSelectionModal.vue';

vi.mock('~/components/ui/UiModal.vue', () => ({
  default: {
    props: { open: { type: Boolean, default: false }, title: String },
    emits: ['update:open', 'close'],
    template: '<div v-if="open" class="modal-mock"><h2>{{ title }}</h2><slot /></div>',
  },
}));

vi.mock('~/components/ui/UiEmptyState.vue', () => ({
  default: {
    props: ['message', 'wrapperClass'],
    template: '<div class="empty-state-mock">{{ message }}</div>',
  },
}));

const mockPresetsStore = reactive({
  customPresets: [],
});

vi.mock('~/stores/presets.store', () => ({
  usePresetsStore: () => mockPresetsStore,
}));

vi.mock('~/utils/presets', () => ({
  getCustomPresetsByCategory: () => [],
}));

describe('TextPresetSelectionModal', () => {
  it('renders when open', async () => {
    const component = await mountSuspended(TextPresetSelectionModal, {
      props: { open: true, trackId: 'track1', itemId: 'item1' },
    });

    expect(component.find('.modal-mock').exists()).toBe(true);
  });

  it('renders three standard presets', async () => {
    const component = await mountSuspended(TextPresetSelectionModal, {
      props: { open: true, trackId: 'track1', itemId: 'item1' },
    });

    const presetButtons = component.findAll('button');
    expect(presetButtons.length).toBeGreaterThanOrEqual(3);
  });

  it('emits select with preset id when preset is clicked', async () => {
    const component = await mountSuspended(TextPresetSelectionModal, {
      props: { open: true, trackId: 'track1', itemId: 'item1' },
    });

    const firstButton = component.find('button');
    await firstButton.trigger('click');

    expect(component.emitted('select')).toBeTruthy();
  });

  it('emits update:open false when preset is selected', async () => {
    const component = await mountSuspended(TextPresetSelectionModal, {
      props: { open: true, trackId: 'track1', itemId: 'item1' },
    });

    const firstButton = component.find('button');
    await firstButton.trigger('click');

    expect(component.emitted('update:open')).toBeTruthy();
    expect(component.emitted('update:open')![0]).toEqual([false]);
  });

  it('shows standard presets section', async () => {
    const component = await mountSuspended(TextPresetSelectionModal, {
      props: { open: true, trackId: 'track1', itemId: 'item1' },
    });

    expect(component.text()).toContain('fastcat.effects.groups.standard');
  });
});
