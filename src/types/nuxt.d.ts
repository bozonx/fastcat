import type { AppNotificationService } from '~/services/app-notification.service';
import type { I18nService } from '~/services/i18n.service';

declare module '#i18n' {
  export * from 'vue-i18n';
}

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

declare module 'nuxt/schema' {
  interface PublicRuntimeConfig {
    blockContextMenu: boolean | string;
  }
}

export {};
