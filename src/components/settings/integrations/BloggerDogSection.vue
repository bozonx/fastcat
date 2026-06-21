<script setup lang="ts">
import IntegrationAccountSection from '~/components/settings/integrations/IntegrationAccountSection.vue';
</script>

<template>
  <IntegrationAccountSection
    integration-key="fastcatPublicador"
    title="BloggerDog"
    hint-key="videoEditor.settings.bloggerDogIntegrationHint"
    connect-action-key="videoEditor.settings.bloggerDogConnectAction"
    api-url-config-key="bloggerDogApiUrl"
    ui-url-config-key="bloggerDogUiUrl"
    target="bloggerdog"
    :include-stt="false"
    missing-config-fallback="BloggerDog API URL or token is missing."
  />
</template>
