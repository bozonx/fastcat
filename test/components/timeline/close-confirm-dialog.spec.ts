import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import CloseConfirmDialog from '~/components/timeline/CloseConfirmDialog.vue';

vi.mock('~/components/ui/UiConfirmModal.vue', () => ({
  default: {
    props: ['open', 'title', 'description', 'confirmText', 'secondaryText', 'cancelText', 'color', 'secondaryColor', 'icon'],
    emits: ['update:open', 'confirm', 'secondary'],
    template: '<div v-if="open" class="confirm-mock"><h2>{{ title }}</h2><p>{{ description }}</p><button class="btn-confirm" @click="$emit(\'confirm\')">{{ confirmText }}</button><button class="btn-secondary" @click="$emit(\'secondary\')">{{ secondaryText }}</button></div>',
  },
}));

const mockUiStore = reactive({
  pendingCloseDialog: null as null | { dirtyCount: number; resolve: (v: string) => void },
});

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

describe('CloseConfirmDialog', () => {
  it('does not render when pendingCloseDialog is null', async () => {
    mockUiStore.pendingCloseDialog = null;

    const component = await mountSuspended(CloseConfirmDialog);

    expect(component.find('.confirm-mock').exists()).toBe(false);
  });

  it('renders when pendingCloseDialog is set', async () => {
    mockUiStore.pendingCloseDialog = { dirtyCount: 1, resolve: vi.fn() };

    const component = await mountSuspended(CloseConfirmDialog);

    expect(component.find('.confirm-mock').exists()).toBe(true);
  });

  it('resolves with save when confirm is clicked', async () => {
    const resolveFn = vi.fn();
    mockUiStore.pendingCloseDialog = { dirtyCount: 1, resolve: resolveFn };

    const component = await mountSuspended(CloseConfirmDialog);

    await component.find('.btn-confirm').trigger('click');

    expect(resolveFn).toHaveBeenCalledWith('save');
    expect(mockUiStore.pendingCloseDialog).toBeNull();
  });

  it('resolves with dont-save when secondary is clicked', async () => {
    const resolveFn = vi.fn();
    mockUiStore.pendingCloseDialog = { dirtyCount: 1, resolve: resolveFn };

    const component = await mountSuspended(CloseConfirmDialog);

    await component.find('.btn-secondary').trigger('click');

    expect(resolveFn).toHaveBeenCalledWith('dont-save');
    expect(mockUiStore.pendingCloseDialog).toBeNull();
  });

  it('resolves with cancel when dialog is dismissed', async () => {
    const resolveFn = vi.fn();
    mockUiStore.pendingCloseDialog = { dirtyCount: 1, resolve: resolveFn };

    const component = await mountSuspended(CloseConfirmDialog);

    component.vm.isOpen = false;

    expect(resolveFn).toHaveBeenCalledWith('cancel');
    expect(mockUiStore.pendingCloseDialog).toBeNull();
  });

  it('shows multiple dirty message when dirtyCount > 1', async () => {
    mockUiStore.pendingCloseDialog = { dirtyCount: 3, resolve: vi.fn() };

    const component = await mountSuspended(CloseConfirmDialog);

    expect(component.text()).toContain('videoEditor.timeline.closeUnsavedMessageMultiple');
  });

  it('shows single dirty message when dirtyCount <= 1', async () => {
    mockUiStore.pendingCloseDialog = { dirtyCount: 1, resolve: vi.fn() };

    const component = await mountSuspended(CloseConfirmDialog);

    expect(component.text()).toContain('videoEditor.timeline.confirmCloseAppMessage');
  });
});
