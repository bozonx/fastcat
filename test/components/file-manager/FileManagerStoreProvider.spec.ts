import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { h, inject } from 'vue';
import FileManagerStoreProvider from '~/components/file-manager/FileManagerStoreProvider.vue';

describe('FileManagerStoreProvider', () => {
  it('provides the store under fileManagerStore key to slot content', async () => {
    const fakeStore = { id: 'fm-store-1' };
    const SlotProbe = {
      setup() {
        const injected = inject('fileManagerStore', null);
        return () => h('div', { class: 'probe' }, injected ? (injected as any).id : 'none');
      },
    };

    const component = await mountSuspended(FileManagerStoreProvider, {
      props: { store: fakeStore },
      slots: { default: () => h(SlotProbe) },
    });

    expect(component.find('.probe').text()).toBe('fm-store-1');
  });
});
