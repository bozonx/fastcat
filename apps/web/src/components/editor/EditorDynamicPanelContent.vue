<script setup lang="ts">
import { computed } from 'vue';
import ProjectView from '~/components/project/ProjectView.vue';
import PropertiesPanel from '~/components/layout-panels/PropertiesPanel.vue';
import MonitorContainer from '~/components/monitor/MonitorContainer.vue';
import MediaPanelWrapper from '~/components/properties/file/MediaPanelWrapper.vue';
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import ProjectEffects from '~/components/project/ProjectEffects.vue';
import ProjectLibrary from '~/components/project/ProjectLibrary.vue';
import ProjectMarkers from '~/components/project/ProjectMarkers.vue';
import ProjectBackups from '~/components/project/ProjectBackups.vue';
import TextEditor from '~/components/preview/TextEditor.vue';
import EditorPanelHeader from '~/components/editor/EditorPanelHeader.vue';
import type { DynamicPanel } from '~/stores/editor-view.store';
import type { PanelFocusId } from '~/stores/focus.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

const workspaceStore = useWorkspaceStore();
const inDevelopmentFeaturesEnabled = computed(() => workspaceStore.inDevelopmentFeaturesEnabled);

interface Props {
  panel: DynamicPanel;
  view: 'cut' | 'sound';
  focusPanelId: PanelFocusId;
}

const props = defineProps<Props>();
const { t } = useI18n();

const emit = defineEmits<{
  close: [panel: DynamicPanel, view: 'cut' | 'sound'];
  focus: [panelId: string];
  moveToView: [panel: DynamicPanel, view: 'cut' | 'sound'];
}>();

function onClose() {
  emit('close', props.panel, props.view);
}

function onFocus() {
  emit('focus', props.panel.id);
}

function movePanelToView(view: 'cut' | 'sound') {
  emit('moveToView', props.panel, view);
}

const mediaIcon = computed(() => {
  switch (props.panel.mediaType) {
    case 'image':
      return 'i-heroicons-photo';
    case 'video':
      return 'i-heroicons-film';
    case 'audio':
      return 'i-heroicons-musical-note';
    default:
      return 'i-heroicons-document';
  }
});

const customPanelContextMenuItems = computed(() => {
  if (props.panel.type !== 'media' && props.panel.type !== 'text') {
    return [];
  }

  const moveTargetView = props.view === 'sound' ? 'cut' : 'sound';
  const moveLabel =
    props.view === 'sound'
      ? t('fastcat.dynamicPanels.moveToCutWindow')
      : t('fastcat.dynamicPanels.moveToSoundWindow');

  return [
    [
      {
        label: moveLabel,
        icon: 'i-heroicons-arrow-right-circle',
        onSelect: () => movePanelToView(moveTargetView),
      },
    ],
    [
      {
        label: t('common.close'),
        icon: 'i-heroicons-x-mark',
        onSelect: onClose,
      },
    ],
  ];
});

const detachedStaticPanelContextMenuItems = computed(() => {
  if (
    !['history', 'effects', 'fileManager', 'library', 'markers', 'backups'].includes(
      props.panel.type,
    )
  ) {
    return [];
  }

  return [
    [
      {
        label: t('fastcat.dynamicPanels.returnToProjectPanel'),
        icon: 'i-heroicons-arrow-uturn-left',
        onSelect: onClose,
      },
    ],
  ];
});
</script>

<template>
  <MonitorContainer
    v-if="panel.type === 'monitor'"
    class="h-full"
    :use-external-focus="true"
    panel-drag-cursor-class=""
    :in-development-features-enabled="inDevelopmentFeaturesEnabled"
  />
  <PropertiesPanel
    v-else-if="panel.type === 'properties'"
    class="h-full"
    :focus-id="focusPanelId"
    :use-external-focus="true"
    :in-development-features-enabled="inDevelopmentFeaturesEnabled"
  />
  <div
    v-else-if="panel.type === 'media'"
    class="h-full w-full bg-ui-bg-elevated flex flex-col relative pt-8 border border-ui-border"
  >
    <EditorPanelHeader
      :title="panel.title || ''"
      :icon="mediaIcon"
      :is-absolute="true"
      :context-menu-items="customPanelContextMenuItems"
      :in-development-features-enabled="inDevelopmentFeaturesEnabled"
      @close="onClose"
    />
    <div class="flex-1 overflow-hidden min-h-0 relative" @pointerdown.capture="onFocus">
      <MediaPanelWrapper
        :file-path="panel.filePath || ''"
        :media-type="panel.mediaType || 'unknown'"
        :focus-panel-id="focusPanelId"
      />
    </div>
  </div>
  <div
    v-else-if="panel.type === 'text'"
    class="h-full w-full bg-ui-bg-elevated flex flex-col pt-8 relative border border-ui-border"
  >
    <EditorPanelHeader
      :title="panel.title || ''"
      icon="i-heroicons-bars-2"
      :is-absolute="true"
      :context-menu-items="customPanelContextMenuItems"
      :in-development-features-enabled="inDevelopmentFeaturesEnabled"
      @close="onClose"
    />
    <div class="flex-1 overflow-hidden min-h-0 relative" @pointerdown.capture="onFocus">
      <TextEditor
        class="absolute inset-0 h-full w-full border-none"
        :file-path="panel.filePath || ''"
        :file-name="panel.title || ''"
        :focus-panel-id="focusPanelId"
      />
    </div>
  </div>
  <div
    v-else-if="panel.type === 'history'"
    class="h-full w-full bg-ui-bg-elevated flex flex-col relative border border-ui-border"
  >
    <EditorPanelHeader
      :title="panel.title || 'History'"
      icon="i-heroicons-clock"
      :context-menu-items="detachedStaticPanelContextMenuItems"
      :in-development-features-enabled="inDevelopmentFeaturesEnabled"
      @close="onClose"
    />
    <div class="flex-1 overflow-hidden min-h-0">
      <ProjectHistory class="h-full" />
    </div>
  </div>
  <div
    v-else-if="panel.type === 'effects'"
    class="h-full w-full bg-ui-bg-elevated flex flex-col relative border border-ui-border"
  >
    <EditorPanelHeader
      :title="panel.title || 'Effects'"
      icon="i-heroicons-sparkles"
      :context-menu-items="detachedStaticPanelContextMenuItems"
      :in-development-features-enabled="inDevelopmentFeaturesEnabled"
      @close="onClose"
    />
    <div class="flex-1 overflow-hidden min-h-0">
      <ProjectEffects class="h-full" />
    </div>
  </div>
  <div
    v-else-if="panel.type === 'library'"
    class="h-full w-full bg-ui-bg-elevated flex flex-col relative border border-ui-border"
  >
    <EditorPanelHeader
      :title="panel.title || 'Library'"
      icon="i-heroicons-rectangle-group"
      :context-menu-items="detachedStaticPanelContextMenuItems"
      :in-development-features-enabled="inDevelopmentFeaturesEnabled"
      @close="onClose"
    />
    <div class="flex-1 overflow-hidden min-h-0">
      <ProjectLibrary class="h-full" />
    </div>
  </div>
  <div
    v-else-if="panel.type === 'markers'"
    class="h-full w-full bg-ui-bg-elevated flex flex-col relative border border-ui-border"
  >
    <EditorPanelHeader
      :title="panel.title || t('videoEditor.fileManager.tabs.markers')"
      icon="i-heroicons-tag"
      :context-menu-items="detachedStaticPanelContextMenuItems"
      :in-development-features-enabled="inDevelopmentFeaturesEnabled"
      @close="onClose"
    />
    <div class="flex-1 overflow-hidden min-h-0">
      <ProjectMarkers class="h-full" />
    </div>
  </div>
  <div
    v-else-if="panel.type === 'backups'"
    class="h-full w-full bg-ui-bg-elevated flex flex-col relative border border-ui-border"
  >
    <EditorPanelHeader
      :title="panel.title || t('videoEditor.timeline.backups.tabLabel')"
      icon="i-heroicons-archive-box"
      :context-menu-items="detachedStaticPanelContextMenuItems"
      :in-development-features-enabled="inDevelopmentFeaturesEnabled"
      @close="onClose"
    />
    <div class="flex-1 overflow-hidden min-h-0">
      <ProjectBackups class="h-full" />
    </div>
  </div>
  <div
    v-else-if="panel.type === 'fileManager'"
    class="h-full w-full bg-ui-bg-elevated flex flex-col relative border border-ui-border"
  >
    <div class="flex-1 overflow-hidden min-h-0">
      <ProjectView
        class="h-full pt-2"
        :use-external-focus="true"
        :compact="view === 'cut'"
        :file-manager-instance-id="panel.id"
      />
    </div>
  </div>
</template>
