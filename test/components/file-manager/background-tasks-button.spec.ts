import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { reactive } from 'vue';
import BackgroundTasksButton from '~/components/file-manager/BackgroundTasksButton.vue';

vi.mock('~/components/file-manager/BackgroundTasksModal.vue', () => ({
  default: { template: '<div class="bg-tasks-modal-mock" />' },
}));

vi.mock('~/components/ui/UiProgressSpinner.vue', () => ({
  default: {
    props: ['progress', 'size'],
    template: '<div class="spinner-mock" :data-progress="progress" />',
  },
}));

const mockBackgroundTasksStore = reactive({
  hasActiveTasks: false,
  globalProgress: 0,
});

const mockUiStore = reactive({
  isBackgroundTasksOpen: false,
});

vi.mock('~/stores/background-tasks.store', () => ({
  useBackgroundTasksStore: () => mockBackgroundTasksStore,
}));

vi.mock('~/stores/ui.store', () => ({
  useUiStore: () => mockUiStore,
}));

describe('BackgroundTasksButton', () => {
  it('renders a button', async () => {
    const component = await mountSuspended(BackgroundTasksButton);

    expect(component.exists()).toBe(true);
    expect(component.find('button').exists()).toBe(true);
    expect(component.find('button').classes()).toContain('aspect-square');
    expect(component.find('button').classes()).toContain('text-ui-text-muted');
  });

  it('shows progress spinner when there are active tasks', async () => {
    mockBackgroundTasksStore.hasActiveTasks = true;
    mockBackgroundTasksStore.globalProgress = 0.5;

    const component = await mountSuspended(BackgroundTasksButton);

    expect(component.find('.spinner-mock').exists()).toBe(true);
    expect(component.find('.spinner-mock').attributes('data-progress')).toBe('50');
  });

  it('shows idle icon when no active tasks', async () => {
    mockBackgroundTasksStore.hasActiveTasks = false;

    const component = await mountSuspended(BackgroundTasksButton);

    expect(component.find('.spinner-mock').exists()).toBe(false);
    expect(component.find('.icon-mock').exists()).toBe(true);
  });

  it('opens modal when button is clicked', async () => {
    mockBackgroundTasksStore.hasActiveTasks = false;
    mockUiStore.isBackgroundTasksOpen = false;

    const component = await mountSuspended(BackgroundTasksButton);

    await component.find('button').trigger('click');

    expect(mockUiStore.isBackgroundTasksOpen).toBe(true);
  });

  it('renders BackgroundTasksModal', async () => {
    const component = await mountSuspended(BackgroundTasksButton);

    expect(component.find('.bg-tasks-modal-mock').exists()).toBe(true);
  });
});
