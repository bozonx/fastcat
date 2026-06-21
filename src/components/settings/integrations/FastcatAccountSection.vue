<script setup lang="ts">
import IntegrationAccountSection from '~/components/settings/integrations/IntegrationAccountSection.vue';
</script>

<template>
  <IntegrationAccountSection
    integration-key="fastcatAccount"
    title="Fastcat Account"
    hint-key="videoEditor.settings.fastcatAccountIntegrationHint"
    connect-action-key="videoEditor.settings.fastcatAccountConnectAction"
    api-url-config-key="fastcatAccountApiUrl"
    ui-url-config-key="fastcatAccountUiUrl"
    target="fastcat"
    :include-stt="true"
    missing-config-fallback="Fastcat Account API URL or token is missing."
  />
</template>
