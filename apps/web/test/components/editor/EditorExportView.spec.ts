import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EditorExportView from '~/components/editor/EditorExportView.vue';

vi.mock('splitpanes', () => ({
  Splitpanes: {
    emits: ['resized'],
    template:
      '<div class="splitpanes-stub"><slot /><button class="emit-resized" @click="$emit(\'resized\', { panes: [{ size: 50 }, { size: 50 }] })" /></div>',
  },
  Pane: {
    props: ['size', 'minSize'],
    template: '<div class="pane-stub"><slot /></div>',
  },
}));

describe('EditorExportView', () => {
  const stubs = {
    ExportForm: { template: '<div class="export-form-stub" />' },
    MonitorContainer: { template: '<div class="monitor-container-stub" />' },
  };

  it('renders ExportForm and MonitorContainer in panes', async () => {
    const component = await mountSuspended(EditorExportView, {
      props: { sizes: [40, 60] },
      global: { stubs },
    });

    expect(component.find('.export-form-stub').exists()).toBe(true);
    expect(component.find('.monitor-container-stub').exists()).toBe(true);
  });

  it('emits resized event with panes payload', async () => {
    const component = await mountSuspended(EditorExportView, {
      props: { sizes: [40, 60] },
      global: { stubs },
    });

    await component.find('.emit-resized').trigger('click');

    expect(component.emitted('resized')).toBeTruthy();
    expect(component.emitted('resized')![0]).toEqual([{ panes: [{ size: 50 }, { size: 50 }] }]);
  });
});
