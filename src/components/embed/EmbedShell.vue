<script setup lang="ts">
import { onMounted } from 'vue';
import MobileMonitorContainer from '~/components/monitor/MobileMonitorContainer.vue';
import MobileTimeline from '~/components/timeline/MobileTimeline.vue';
import UiProgressSpinner from '~/components/ui/UiProgressSpinner.vue';
import { useEmbedSession } from '~/composables/embed/useEmbedSession';

const { t } = useI18n();
const session = useEmbedSession();

onMounted(() => {
  session.start();
});
</script>

<template>
  <div
    class="flex flex-col h-full w-full bg-ui-bg overflow-hidden"
    data-testid="embed-shell"
    :data-phase="session.phase.value"
  >
    <div
      v-if="session.phase.value === 'standalone'"
      class="flex-1 flex items-center justify-center p-8 text-center text-ui-text-muted"
      data-testid="embed-standalone-notice"
    >
      {{ t('fastcat.embed.standaloneNotice') }}
    </div>

    <div
      v-else-if="session.phase.value === 'error'"
      class="flex-1 flex items-center justify-center p-8 text-center text-error"
      data-testid="embed-error"
    >
      {{ session.errorMessage.value }}
    </div>

    <div
      v-else-if="session.phase.value === 'handshake' || session.phase.value === 'loading'"
      class="flex-1 flex items-center justify-center gap-3 text-ui-text-muted"
      data-testid="embed-loading"
    >
      <UiProgressSpinner class="size-5" />
      <span>{{ t('fastcat.embed.preparing') }}</span>
    </div>

    <template v-else>
      <header
        class="flex items-center justify-end gap-2 px-3 py-2 border-b border-ui-border shrink-0"
      >
        <UButton
          size="sm"
          color="primary"
          data-testid="embed-export"
          :loading="session.phase.value === 'exporting'"
          :disabled="!session.canExport.value || session.phase.value === 'exporting'"
          @click="session.startExport()"
        >
          {{ t('videoEditor.export.startExport') }}
        </UButton>
      </header>

      <div class="flex-1 min-h-0">
        <MobileMonitorContainer flexible />
      </div>

      <div class="h-2/5 min-h-0 border-t border-ui-border">
        <MobileTimeline />
      </div>
    </template>
  </div>
</template>
