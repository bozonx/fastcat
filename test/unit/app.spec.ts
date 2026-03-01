import { describe, it, expect, vi } from 'vitest';
import App from '../../src/app.vue';
import { mountWithNuxt } from '../utils/mount';

vi.mock('#imports', () => ({
  useColorMode: () => ({
    preference: 'dark',
    value: 'dark',
  }),
  useHead: vi.fn(),
}));

describe('App Smoke Test', () => {
  it('can mount the app root component', async () => {
    const component = await mountWithNuxt(App);
    expect(component.exists()).toBe(true);
  });
});
