/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { useMobileLayout } from '~/composables/useMobileLayout';

const mockRoute = reactive({ path: '/' });

// `useRoute` is auto-imported from `#app/composables/router`, so the mock must target it.
vi.mock('#app/composables/router', () => ({
  useRoute: () => mockRoute,
}));

describe('useMobileLayout', () => {
  beforeEach(() => {
    mockRoute.path = '/';
  });

  it('returns true for the mobile root route', () => {
    mockRoute.path = '/m';
    const { isMobileLayout } = useMobileLayout();
    expect(isMobileLayout.value).toBe(true);
  });

  it('returns true for nested mobile routes', () => {
    mockRoute.path = '/m/editor/project-1';
    const { isMobileLayout } = useMobileLayout();
    expect(isMobileLayout.value).toBe(true);
  });

  it('returns false for the desktop root route', () => {
    mockRoute.path = '/';
    const { isMobileLayout } = useMobileLayout();
    expect(isMobileLayout.value).toBe(false);
  });

  it('returns false for non-mobile routes', () => {
    mockRoute.path = '/editor/project-1';
    const { isMobileLayout } = useMobileLayout();
    expect(isMobileLayout.value).toBe(false);
  });

  it('returns false for routes that merely start with the letter m', () => {
    mockRoute.path = '/monitor';
    const { isMobileLayout } = useMobileLayout();
    expect(isMobileLayout.value).toBe(false);
  });

  it('reacts to route path changes', () => {
    mockRoute.path = '/';
    const { isMobileLayout } = useMobileLayout();
    expect(isMobileLayout.value).toBe(false);

    mockRoute.path = '/m/editor/project-2';
    expect(isMobileLayout.value).toBe(true);
  });
});
