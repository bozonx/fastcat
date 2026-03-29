import type { AppNotificationService } from '~/services/app-notification.service';
import type { I18nService } from '~/services/i18n.service';

export default defineNuxtPlugin((nuxtApp) => {
  const toast = useToast();

  // Cast i18n properly to match our interface
  const i18n = nuxtApp.$i18n as unknown as { t: (key: string, ...args: unknown[]) => string };

  const notificationService: AppNotificationService = {
    add: (notification) => {
      toast.add(notification);
    },
  };

  const i18nService: I18nService = {
    t: (key, ...args) => {
      return i18n.t(key, ...args);
    },
  };

  return {
    provide: {
      notificationService,
      i18nService,
    },
  };
});
