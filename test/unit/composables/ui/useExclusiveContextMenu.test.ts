import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import { describe, expect, it } from 'vitest';
import { useExclusiveContextMenu } from '~/composables/ui/useExclusiveContextMenu';

function mountContextMenuHost() {
  return mount(
    defineComponent({
      setup() {
        const contextMenu = useExclusiveContextMenu();
        return { contextMenu };
      },
      render() {
        return h('div');
      },
    }),
  );
}

describe('useExclusiveContextMenu', () => {
  it('closes an already open menu when another menu opens', async () => {
    const first = mountContextMenuHost();
    const second = mountContextMenuHost();

    first.vm.contextMenu.setContextMenuOpen(true);
    await nextTick();

    expect(first.vm.contextMenu.isContextMenuOpen.value).toBe(true);
    expect(second.vm.contextMenu.isContextMenuOpen.value).toBe(false);

    second.vm.contextMenu.setContextMenuOpen(true);
    await nextTick();

    expect(first.vm.contextMenu.isContextMenuOpen.value).toBe(false);
    expect(second.vm.contextMenu.isContextMenuOpen.value).toBe(true);

    first.unmount();
    second.unmount();
  });
});
