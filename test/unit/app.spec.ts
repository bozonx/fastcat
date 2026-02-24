import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import App from '../../src/app.vue';

vi.mock('#imports', () => ({
  useColorMode: () => ({
    preference: 'dark',
    value: 'dark',
  }),
  useHead: vi.fn(),
}));

describe('App Smoke Test', () => {
  it('can mount the app root component', async () => {
    const component = await mountSuspended(App);
    expect(component.exists()).toBe(true);
  });
});
