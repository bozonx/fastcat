import { normalizeLocale } from '~/utils/settings/normalizers/shared';

export default defineNuxtPlugin((nuxtApp) => {
  const workspaceStore = useWorkspaceStore();
  const i18n = (
    nuxtApp as unknown as {
      $i18n?: { locale?: { value: string }; setLocale?: (l: string) => Promise<void> };
    }
  ).$i18n;

  const applyLocale = async (nextLocale: string) => {
    if (!i18n?.setLocale || !i18n.locale) return;
    const locale = normalizeLocale({ locale: nextLocale });
    if (i18n.locale.value === locale) return;
    await i18n.setLocale(locale);
  };

  watch(
    () =>
      [
        workspaceStore?.isInitializing ?? false,
        workspaceStore?.userSettings?.locale ?? 'en-US',
      ] as const,
    async ([isInitializing, userLocale]) => {
      if (isInitializing) return;
      await applyLocale(userLocale);
    },
    { immediate: true },
  );
});
