export default defineNuxtPlugin((nuxtApp) => {
  const workspaceStore = useWorkspaceStore();
  const i18n = (
    nuxtApp as unknown as {
      $i18n?: { locale?: { value: string }; setLocale?: (l: string) => Promise<void> };
    }
  ).$i18n;

  const applyLocale = async (nextLocale: string) => {
    if (!i18n?.setLocale || !i18n.locale) return;
    if (i18n.locale.value === nextLocale) return;
    await i18n.setLocale(nextLocale);
  };

  watch(
    () => [workspaceStore.isInitializing, workspaceStore.userSettings.locale] as const,
    async ([isInitializing, userLocale]) => {
      if (isInitializing) return;
      await applyLocale(userLocale);
    },
    { immediate: true },
  );
});
