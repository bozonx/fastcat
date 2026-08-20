import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, ref } from 'vue';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import MobileForegroundTaskOverlay from '~/components/ui/MobileForegroundTaskOverlay.vue';

const isMobileLayout = ref(true);

const mockBackgroundTasksStore = reactive({
  hasActiveTasks: false,
  activeTasks: [] as Array<{
    id: string;
    title: string;
    description?: string;
    progress: number;
    cancel?: () => void;
  }>,
  cancelTask: vi.fn(),
});

vi.mock('~/composables/useMobileLayout', () => ({
  useMobileLayout: () => ({ isMobileLayout }),
}));

vi.mock('~/stores/background-tasks.store', () => ({
  useBackgroundTasksStore: () => mockBackgroundTasksStore,
}));

describe('MobileForegroundTaskOverlay', () => {
  beforeEach(() => {
    isMobileLayout.value = true;
    mockBackgroundTasksStore.hasActiveTasks = false;
    mockBackgroundTasksStore.activeTasks = [];
    mockBackgroundTasksStore.cancelTask.mockClear();
  });

  it('does not render when there are no active tasks', async () => {
    const wrapper = await mountSuspended(MobileForegroundTaskOverlay);
    expect(wrapper.find('.fixed').exists()).toBe(false);
  });

  it('does not render on desktop even when tasks are active', async () => {
    isMobileLayout.value = false;
    mockBackgroundTasksStore.hasActiveTasks = true;
    mockBackgroundTasksStore.activeTasks = [{ id: 't1', title: 'Export', progress: 0.5 }];
    const wrapper = await mountSuspended(MobileForegroundTaskOverlay);
    expect(wrapper.find('.fixed').exists()).toBe(false);
  });

  it('renders the task list on mobile when tasks are active', async () => {
    mockBackgroundTasksStore.hasActiveTasks = true;
    mockBackgroundTasksStore.activeTasks = [
      { id: 't1', title: 'Exporting', description: 'Please wait', progress: 0.75 },
    ];
    await mountSuspended(MobileForegroundTaskOverlay);
    const overlay = document.body.querySelector('.fixed');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain('Exporting');
    expect(overlay!.textContent).toContain('Please wait');
    expect(overlay!.textContent).toContain('75%');
  });

  it('calls cancelTask when the cancel button is present', async () => {
    mockBackgroundTasksStore.hasActiveTasks = true;
    mockBackgroundTasksStore.activeTasks = [
      { id: 't1', title: 'Export', progress: 0.5, cancel: vi.fn() },
    ];
    await mountSuspended(MobileForegroundTaskOverlay);

    const button = document.body.querySelector('.fixed button');
    expect(button).not.toBeNull();
    await (button as HTMLButtonElement).click();
    expect(mockBackgroundTasksStore.cancelTask).toHaveBeenCalledWith('t1');
  });

  it('displays progress for each task without description', async () => {
    mockBackgroundTasksStore.hasActiveTasks = true;
    mockBackgroundTasksStore.activeTasks = [{ id: 't1', title: 'Task A', progress: 0.33 }];
    await mountSuspended(MobileForegroundTaskOverlay);
    const overlay = document.body.querySelector('.fixed');
    expect(overlay!.textContent).toContain('33%');
  });
});
