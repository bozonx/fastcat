<script setup lang="ts">
import { computed, onMounted, provide, ref, watch } from 'vue';
import EditorRoot from '~/components/editor/EditorRoot.vue';
import type { MobileShellTab } from '~/components/editor/MobileShell.vue';
import EmbedExportDialog from '~/components/embed/EmbedExportDialog.vue';
import EmbedFormatBadge from '~/components/embed/EmbedFormatBadge.vue';
import EmbedFormatDialog from '~/components/embed/EmbedFormatDialog.vue';
import UiProgressSpinner from '~/components/ui/UiProgressSpinner.vue';
import UiSplitDropdownButton from '~/components/ui/UiSplitDropdownButton.vue';
import { useEmbedSession } from '~/composables/embed/useEmbedSession';
import { useEmbedFeatures } from '~/utils/embed-features';
import { EMBED_EXPORT_KEY, embedDialog } from '~/utils/embed/embed-export';
import { summarizeEmbedFormat } from '~/utils/embed/format-summary';
import { useProjectStore } from '~/stores/project.store';
import { useTimelineStore } from '~/stores/timeline.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

const { t } = useI18n();
const session = useEmbedSession();
const projectStore = useProjectStore();
const timelineStore = useTimelineStore();
const workspaceStore = useWorkspaceStore();
const { isEnabled } = useEmbedFeatures();

provide(EMBED_EXPORT_KEY, {
  canExport: session.canExport,
  start: async (form) => {
    await session.startExport(undefined, form);
    // The render has gone to the host; what is left of the dialog is a form
    // for an export that already happened.
    if (form.lastExportStatus.value === 'success') embedDialog.value = null;
  },
});

const editorRoot = ref<InstanceType<typeof EditorRoot> | null>(null);
const hasWebGpu = typeof navigator !== 'undefined' && !!navigator.gpu;

const layoutMode = computed(() => editorRoot.value?.mode ?? null);
const isDesktopLayout = computed(() => layoutMode.value === 'desktop');

type EmbedViewId = 'files' | 'cut' | 'sound' | 'settings';

/**
 * Views the host switched on, in the order the toolbar shows them. Export is
 * not among them: it is an action on the toolbar, with its settings in a
 * dialog. The touch shell has no sound view, and the desktop one has no
 * settings view.
 */
const viewTabs = computed(() => {
  const views: { id: EmbedViewId; labelKey: string; icon: string }[] = [];
  if (isEnabled('files')) {
    views.push({ id: 'files', labelKey: 'common.files', icon: 'lucide:folder-open' });
  }
  views.push({ id: 'cut', labelKey: 'common.edit', icon: 'lucide:clapperboard' });
  if (isDesktopLayout.value && isEnabled('sound')) {
    views.push({ id: 'sound', labelKey: 'common.sound', icon: 'lucide:audio-lines' });
  }
  if (!isDesktopLayout.value && isEnabled('settings')) {
    views.push({ id: 'settings', labelKey: 'common.settings', icon: 'lucide:settings' });
  }
  return views;
});

/** A single view is not a choice; the switcher only appears when there is one. */
const showViewTabs = computed(() => viewTabs.value.length > 1);

const mobileTabs = computed<MobileShellTab[]>(() =>
  viewTabs.value.map((view) => (view.id === 'cut' ? 'edit' : view.id) as MobileShellTab),
);

function isViewActive(id: EmbedViewId): boolean {
  const current = projectStore.currentView;
  if (id === 'cut') return !viewTabs.value.some((view) => view.id === current);
  return current === id;
}

/** Meant for checking the touch shell on a desktop, not for everyday editing. */
const canToggleLayout = computed(() => workspaceStore.inDevelopmentFeaturesEnabled);

const formatSummary = computed(() => summarizeEmbedFormat(timelineStore.timelineFormat));
const formatDialogPurpose = ref<'edit' | 'export'>('edit');

const isFormatDialogOpen = computed({
  get: () => embedDialog.value === 'format',
  set: (open: boolean) => {
    embedDialog.value = open ? 'format' : null;
  },
});

const isExportSettingsOpen = computed({
  get: () => embedDialog.value === 'export-settings',
  set: (open: boolean) => {
    embedDialog.value = open ? 'export-settings' : null;
  },
});

function openFormatDialog(purpose: 'edit' | 'export') {
  formatDialogPurpose.value = purpose;
  embedDialog.value = 'format';
}

const isExporting = computed(() => session.phase.value === 'exporting');

/** Rendering at a format nobody chose would hand the host a guess. */
function exportNow() {
  if (formatSummary.value.source === 'unresolved') {
    openFormatDialog('export');
    return;
  }
  void session.startExport();
}

function onFormatApplied() {
  if (formatDialogPurpose.value === 'export') void session.startExport();
}

const exportMenuItems = computed(() =>
  isEnabled('export')
    ? [
        [
          {
            label: t('fastcat.embed.advancedExport'),
            icon: 'lucide:sliders-horizontal',
            onSelect: () => {
              embedDialog.value = 'export-settings';
            },
          },
        ],
      ]
    : [],
);

const hasTimelineClips = computed(
  () =>
    timelineStore.timelineDoc?.tracks.some((track) =>
      track.items.some((item) => item.kind === 'clip'),
    ) ?? false,
);

/**
 * Asks for the format once, as soon as the host's media has settled without
 * deciding it — a session of photos, say. Asked then rather than at export, the
 * answer frames every edit instead of re-fitting them at the end.
 */
let hasAskedForFormat = false;
watch(
  () =>
    session.phase.value === 'ready' &&
    !session.isIngesting.value &&
    hasTimelineClips.value &&
    formatSummary.value.source === 'unresolved',
  (shouldAsk) => {
    if (!shouldAsk || hasAskedForFormat || embedDialog.value) return;
    hasAskedForFormat = true;
    openFormatDialog('edit');
  },
);

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
        <div v-if="showViewTabs" class="flex items-center gap-1 min-w-0">
          <UButton
            v-for="view in viewTabs"
            :key="view.id"
            size="sm"
            :icon="view.icon"
            :color="isViewActive(view.id) ? 'primary' : 'neutral'"
            :variant="isViewActive(view.id) ? 'solid' : 'ghost'"
            :aria-pressed="isViewActive(view.id)"
            :aria-label="t(view.labelKey)"
            :data-testid="`embed-view-${view.id}`"
            @click="projectStore.setView(view.id)"
          >
            <span v-if="isDesktopLayout">{{ t(view.labelKey) }}</span>
          </UButton>
        </div>

        <div class="flex-1" />

        <UButton
          v-if="canToggleLayout"
          size="sm"
          color="neutral"
          variant="ghost"
          :icon="isDesktopLayout ? 'lucide:smartphone' : 'lucide:monitor'"
          :aria-label="t('fastcat.embed.toggleLayout')"
          :title="t('fastcat.embed.toggleLayout')"
          data-testid="embed-toggle-layout"
          @click="editorRoot?.toggle()"
        />

        <EmbedFormatBadge
          :summary="formatSummary"
          :compact="!isDesktopLayout"
          @open="openFormatDialog('edit')"
        />

        <UiSplitDropdownButton
          v-if="exportMenuItems.length"
          color="primary"
          variant="solid"
          icon="lucide:download"
          main-test-id="embed-export"
          :label="t('videoEditor.export.startExport')"
          v-bind="{ ariaLabel: t('videoEditor.export.startExport') }"
          :caret-aria-label="t('fastcat.embed.exportMenu')"
          :loading="isExporting"
          :disabled="!session.canExport.value || isExporting"
          :items="exportMenuItems"
          @click="exportNow"
        />
        <UButton
          v-else
          size="sm"
          color="primary"
          icon="lucide:download"
          data-testid="embed-export"
          :loading="isExporting"
          :disabled="!session.canExport.value || isExporting"
          @click="exportNow"
        >
          {{ t('videoEditor.export.startExport') }}
        </UButton>

        <!-- Leaving the editor is the host's business, kept apart from editing. -->
        <div class="h-5 w-px bg-ui-border" aria-hidden="true" />
        <UButton
          size="sm"
          color="neutral"
          variant="ghost"
          icon="lucide:x"
          :aria-label="t('fastcat.embed.closeEditor')"
          :title="t('fastcat.embed.closeEditor')"
          data-testid="embed-close"
          @click="session.requestClose()"
        />
      </header>

      <div class="flex-1 min-h-0">
        <EditorRoot
          ref="editorRoot"
          :layout="session.layoutPreference.value"
          :mobile-tabs="mobileTabs"
          :show-mobile-nav="false"
          nav-mode="embedded"
          embedded
        />
      </div>

      <EmbedFormatDialog
        v-model:open="isFormatDialogOpen"
        :purpose="formatDialogPurpose"
        @applied="onFormatApplied"
      />
      <EmbedExportDialog v-model:open="isExportSettingsOpen" :is-exporting="isExporting" />
    </template>
  </div>
</template>
