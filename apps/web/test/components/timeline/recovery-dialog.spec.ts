import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import RecoveryDialog from '~/components/timeline/RecoveryDialog.vue';

vi.mock('~/components/ui/UiModal.vue', () => ({
  default: {
    props: {
      open: { type: Boolean, default: false },
      title: String,
      preventClose: Boolean,
      closeButton: Boolean,
      ui: Object,
    },
    emits: ['update:open'],
    template: '<div v-if="open" class="modal-mock"><h2>{{ title }}</h2><slot /></div>',
  },
}));

const mockUiStore = reactive({
  pendingRecoveryDialog: null as null | {
    timelinePath: string;
    resolve: (v: string) => void;
  },
});

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

describe('RecoveryDialog', () => {
  it('does not render when pendingRecoveryDialog is null', async () => {
    mockUiStore.pendingRecoveryDialog = null;

    const component = await mountSuspended(RecoveryDialog);

    expect(component.find('.modal-mock').exists()).toBe(false);
  });

  it('renders when pendingRecoveryDialog is set', async () => {
    mockUiStore.pendingRecoveryDialog = {
      timelinePath: '/projects/my_timeline.json',
      resolve: vi.fn(),
    };

    const component = await mountSuspended(RecoveryDialog);

    expect(component.find('.modal-mock').exists()).toBe(true);
  });

  it('extracts timeline name from path', async () => {
    mockUiStore.pendingRecoveryDialog = {
      timelinePath: '/projects/my_timeline.json',
      resolve: vi.fn(),
    };

    const component = await mountSuspended(RecoveryDialog);

    const descriptionP = component.find('p[title]');
    expect(descriptionP.attributes('title')).toBe('my_timeline.json');
  });

  it('resolves with restore-autosave when restore button is clicked', async () => {
    const resolveFn = vi.fn();
    mockUiStore.pendingRecoveryDialog = {
      timelinePath: '/projects/test.json',
      resolve: resolveFn,
    };

    const component = await mountSuspended(RecoveryDialog);

    const buttons = component.findAll('button');
    const restoreButton = buttons[0];
    await restoreButton.trigger('click');

    expect(resolveFn).toHaveBeenCalledWith('restore-autosave');
    expect(mockUiStore.pendingRecoveryDialog).toBeNull();
  });

  it('resolves with open-saved when open saved button is clicked', async () => {
    const resolveFn = vi.fn();
    mockUiStore.pendingRecoveryDialog = {
      timelinePath: '/projects/test.json',
      resolve: resolveFn,
    };

    const component = await mountSuspended(RecoveryDialog);

    const buttons = component.findAll('button');
    const openSavedButton = buttons[1];
    await openSavedButton.trigger('click');

    expect(resolveFn).toHaveBeenCalledWith('open-saved');
    expect(mockUiStore.pendingRecoveryDialog).toBeNull();
  });

  it('toggles learn more section', async () => {
    mockUiStore.pendingRecoveryDialog = {
      timelinePath: '/test.json',
      resolve: vi.fn(),
    };

    const component = await mountSuspended(RecoveryDialog);

    const learnMoreButton = component
      .findAll('button')
      .find((b) => b.text().includes('recoveryLearnMore'));
    if (learnMoreButton) {
      await learnMoreButton.trigger('click');
      expect(component.text()).toContain('recoveryLearnMoreRestore');
    }
  });
});
