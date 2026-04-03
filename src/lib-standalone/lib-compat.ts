import { inject } from 'vue';

/**
 * Mock for Nuxt's useNuxtApp to support standalone builds.
 */
export function useNuxtApp() {
  // In a real app, these would be provided by the host or initialized in index.lib.ts
  return {
    $isEmbedded: inject('isEmbedded', false),
    $notificationService: inject('notificationService', { 
      add: (msg: any) => console.log('Notification:', msg) 
    }),
    $i18nService: inject('i18nService', { 
      t: (key: string, defaultValue?: string) => defaultValue || key 
    }),
    $i18n: inject('i18n', { 
      t: (key: string, defaultValue?: string) => defaultValue || key,
      locale: { value: 'en-US' } 
    }),
  };
}

export function useRuntimeConfig() {
  return {
    public: {
      bloggerDogApiUrl: '',
      bloggerDogUiUrl: '',
      bloggerDogToken: '',
    }
  };
}

export function useRoute() {
  return {
    path: '/',
    query: {},
    params: {},
  };
}

export function useRouter() {
  return {
    push: () => {},
    replace: () => {},
  };
}

// Add other Nuxt-specific mocks as needed
