import type { AppNotificationService } from '~/services/app-notification.service';
import type { I18nService } from '~/services/i18n.service';

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
