import type { AppNotificationService } from '~/services/AppNotificationService';
import type { I18nService } from '~/services/I18nService';

declare module '#app' {
  interface NuxtApp {
    $notificationService: AppNotificationService;
    $i18nService: I18nService;
  }
}

declare module 'vue' {
  interface ComponentCustomProperties {
    $notificationService: AppNotificationService;
    $i18nService: I18nService;
  }
}

export {};
