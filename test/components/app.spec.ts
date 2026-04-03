import { describe, it, expect, vi } from 'vitest';
import App from '~/app.vue';
import { mountWithNuxt } from '../utils/mount';

vi.mock('#imports', () => ({
  useColorMode: () => ({
    preference: 'dark',
    value: 'dark',
  }),
  useHead: vi.fn(),
}));

vi.mock('#ui/composables/useToast', () => ({
  toastMaxInjectionKey: Symbol('toastMaxInjectionKey'),
}));

describe('App Smoke Test', () => {
  it('can mount the app root component', async () => {
    const component = await mountWithNuxt(App);
    expect(component.exists()).toBe(true);
  }, 15000);
});
