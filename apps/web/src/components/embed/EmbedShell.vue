<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import EditorRoot from '~/components/editor/EditorRoot.vue';
import type { MobileShellTab } from '~/components/editor/MobileShell.vue';
import UiProgressSpinner from '~/components/ui/UiProgressSpinner.vue';
import { useEmbedSession } from '~/composables/embed/useEmbedSession';
import { useEmbedFeatures } from '~/utils/embed-features';
import { useProjectStore } from '~/stores/project.store';

const { t } = useI18n();
const session = useEmbedSession();
const projectStore = useProjectStore();
const { isEnabled } = useEmbedFeatures();

const editorRoot = ref<InstanceType<typeof EditorRoot> | null>(null);
const hasWebGpu = typeof navigator !== 'undefined' && !!navigator.gpu;

/** Views the host switched on, in the order the toolbar shows them. */
const desktopViews = computed(() => {
  const views: { id: 'files' | 'cut' | 'sound' | 'export'; labelKey: string; icon: string }[] = [];
  if (isEnabled('files')) {
    views.push({ id: 'files', labelKey: 'common.files', icon: 'lucide:folder-open' });
  }
  views.push({ id: 'cut', labelKey: 'common.edit', icon: 'lucide:clapperboard' });
  if (isEnabled('sound')) {
    views.push({ id: 'sound', labelKey: 'common.sound', icon: 'lucide:audio-lines' });
  }
  if (isEnabled('export')) {
    views.push({ id: 'export', labelKey: 'common.export', icon: 'lucide:download' });
  }
  return views;
});

const mobileTabs = computed<MobileShellTab[]>(() => {
  const tabs: MobileShellTab[] = [];
  if (isEnabled('files')) tabs.push('files');
  tabs.push('edit');
  if (isEnabled('export')) tabs.push('export');
  if (isEnabled('settings')) tabs.push('settings');
  return tabs;
});

const layoutMode = computed(() => editorRoot.value?.mode ?? null);
const isDesktopLayout = computed(() => layoutMode.value === 'desktop');

/** Below this a monitor, a timeline and a toolbar cannot all be usable. */
const MIN_WORKABLE_HEIGHT_PX = { desktop: 560, mobile: 480 } as const;

watch(layoutMode, (mode) => {
  if (!mode) return;
  const required = MIN_WORKABLE_HEIGHT_PX[mode];
  if (window.innerHeight < required) session.requestResize(required);
});

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
      <div
        v-if="!hasWebGpu"
        class="flex items-start gap-2 border-b border-warning-500/30 bg-warning-500/10 px-3 py-2 text-sm text-warning-100"
        data-testid="embed-webgpu-warning"
        role="status"
      >
        <UIcon name="i-heroicons-exclamation-triangle" class="mt-0.5 size-4 shrink-0" />
        <span>{{ t('fastcat.embed.webGpuWarning') }}</span>
      </div>
      <header
        class="flex items-center gap-2 px-3 py-2 border-b border-ui-border shrink-0"
        data-testid="embed-toolbar"
      >
        <!-- The mobile shell carries its own bottom navigation. -->
        <div v-if="isDesktopLayout" class="flex items-center gap-1">
          <UButton
            v-for="view in desktopViews"
            :key="view.id"
            size="sm"
            :icon="view.icon"
            :color="projectStore.currentView === view.id ? 'primary' : 'neutral'"
            :variant="projectStore.currentView === view.id ? 'solid' : 'ghost'"
            :aria-pressed="projectStore.currentView === view.id"
            :data-testid="`embed-view-${view.id}`"
            @click="projectStore.setView(view.id)"
          >
            {{ t(view.labelKey) }}
          </UButton>
        </div>

        <div class="flex-1" />

        <UButton
          size="sm"
          color="neutral"
          variant="ghost"
          :icon="isDesktopLayout ? 'lucide:smartphone' : 'lucide:monitor'"
          :aria-label="t('fastcat.embed.toggleLayout')"
          :title="t('fastcat.embed.toggleLayout')"
          data-testid="embed-toggle-layout"
          @click="editorRoot?.toggle()"
        />

        <UButton
          size="sm"
          color="neutral"
          variant="ghost"
          icon="lucide:x"
          :aria-label="t('common.close')"
          :title="t('common.close')"
          data-testid="embed-close"
          @click="session.requestClose()"
        />

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
        <EditorRoot
          ref="editorRoot"
          :layout="session.layoutPreference.value"
          :mobile-tabs="mobileTabs"
          nav-mode="embedded"
          embedded
        />
      </div>
    </template>
  </div>
</template>
