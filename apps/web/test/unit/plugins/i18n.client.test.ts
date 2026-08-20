import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive, nextTick } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';

import i18nClientPlugin from '~/plugins/i18n.client';

vi.mock('~/stores/workspace.store', () => ({
  useWorkspaceStore: vi.fn(),
}));

type WorkspaceStoreMock = {
  isInitializing: boolean;
  userSettings: { locale: string | undefined };
};

function createNuxtApp(initialLocale = 'en-US') {
  const i18nLocale = reactive({ value: initialLocale });
  const setLocale = vi.fn(async (next: string) => {
    i18nLocale.value = next;
  });
  return {
    nuxtApp: { $i18n: { locale: i18nLocale, setLocale } } as unknown as Parameters<
      typeof i18nClientPlugin
    >[0],
    setLocale,
    i18nLocale,
  };
}

function setStoreMock(store: WorkspaceStoreMock) {
  (useWorkspaceStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue(store);
}

describe('i18n.client plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes short "en" locale to "en-US" before calling setLocale', async () => {
    const store = reactive<WorkspaceStoreMock>({
      isInitializing: false,
      userSettings: { locale: 'en' },
    });
    setStoreMock(store);
    const { nuxtApp, setLocale, i18nLocale } = createNuxtApp('ru-RU');

    i18nClientPlugin(nuxtApp);
    await nextTick();
    await nextTick();

    expect(setLocale).toHaveBeenCalledWith('en-US');
    expect(i18nLocale.value).toBe('en-US');
  });

  it('normalizes short "ru" locale to "ru-RU" before calling setLocale', async () => {
    const store = reactive<WorkspaceStoreMock>({
      isInitializing: false,
      userSettings: { locale: 'ru' },
    });
    setStoreMock(store);
    const { nuxtApp, setLocale, i18nLocale } = createNuxtApp('en-US');

    i18nClientPlugin(nuxtApp);
    await nextTick();
    await nextTick();

    expect(setLocale).toHaveBeenCalledWith('ru-RU');
    expect(i18nLocale.value).toBe('ru-RU');
  });

  it('falls back to default "en-US" for an unknown locale value', async () => {
    const store = reactive<WorkspaceStoreMock>({
      isInitializing: false,
      userSettings: { locale: 'fr-FR' },
    });
    setStoreMock(store);
    const { nuxtApp, setLocale } = createNuxtApp('ru-RU');

    i18nClientPlugin(nuxtApp);
    await nextTick();
    await nextTick();

    expect(setLocale).toHaveBeenCalledWith('en-US');
  });

  it('collapses any regional Spanish variant to "es-419" before calling setLocale', async () => {
    const store = reactive<WorkspaceStoreMock>({
      isInitializing: false,
      userSettings: { locale: 'es-MX' },
    });
    setStoreMock(store);
    const { nuxtApp, setLocale, i18nLocale } = createNuxtApp('en-US');

    i18nClientPlugin(nuxtApp);
    await nextTick();
    await nextTick();

    expect(setLocale).toHaveBeenCalledWith('es-419');
    expect(i18nLocale.value).toBe('es-419');
  });

  it('skips setLocale while the workspace is still initializing', async () => {
    const store = reactive<WorkspaceStoreMock>({
      isInitializing: true,
      userSettings: { locale: 'ru-RU' },
    });
    setStoreMock(store);
    const { nuxtApp, setLocale } = createNuxtApp('en-US');

    i18nClientPlugin(nuxtApp);
    await nextTick();

    expect(setLocale).not.toHaveBeenCalled();

    store.isInitializing = false;
    await nextTick();
    await nextTick();

    expect(setLocale).toHaveBeenCalledWith('ru-RU');
  });

  it('does not call setLocale when the normalized locale already matches current i18n locale', async () => {
    const store = reactive<WorkspaceStoreMock>({
      isInitializing: false,
      userSettings: { locale: 'en' },
    });
    setStoreMock(store);
    const { nuxtApp, setLocale } = createNuxtApp('en-US');

    i18nClientPlugin(nuxtApp);
    await nextTick();
    await nextTick();

    expect(setLocale).not.toHaveBeenCalled();
  });

  it('reacts to user settings locale changes and normalizes the new value', async () => {
    const store = reactive<WorkspaceStoreMock>({
      isInitializing: false,
      userSettings: { locale: 'en-US' },
    });
    setStoreMock(store);
    const { nuxtApp, setLocale } = createNuxtApp('en-US');

    i18nClientPlugin(nuxtApp);
    await nextTick();
    await nextTick();

    expect(setLocale).not.toHaveBeenCalled();

    store.userSettings.locale = 'ru';
    await nextTick();
    await nextTick();

    expect(setLocale).toHaveBeenCalledWith('ru-RU');
  });

  it('uses "en-US" default when userSettings.locale is missing', async () => {
    const store = reactive<WorkspaceStoreMock>({
      isInitializing: false,
      userSettings: { locale: undefined },
    });
    setStoreMock(store);
    const { nuxtApp, setLocale } = createNuxtApp('ru-RU');

    i18nClientPlugin(nuxtApp);
    await nextTick();
    await nextTick();

    expect(setLocale).toHaveBeenCalledWith('en-US');
  });
});
