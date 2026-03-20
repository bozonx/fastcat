<script setup lang="ts">
import { computed } from 'vue';
import Project from '~/components/project/Project.vue';
import PropertiesPanel from '~/components/layout-panels/PropertiesPanel.vue';
import MonitorContainer from '~/components/monitor/MonitorContainer.vue';
import MediaPanelWrapper from '~/components/properties/file/MediaPanelWrapper.vue';
import ProjectHistory from '~/components/project/ProjectHistory.vue';
import ProjectEffects from '~/components/project/ProjectEffects.vue';
import TextEditor from '~/components/preview/TextEditor.vue';
import EditorPanelHeader from '~/components/editor/EditorPanelHeader.vue';
import type { DynamicPanel } from '~/stores/editor-view.store';
import type { PanelFocusId } from '~/stores/focus.store';

interface Props {
  panel: DynamicPanel;
  view: 'cut' | 'sound';
  focusPanelId: PanelFocusId;
}

const props = defineProps<Props>();
const { t } = useI18n();

const emit = defineEmits<{
  dragStart: [event: DragEvent, panelId: string];
  close: [panel: DynamicPanel, view: 'cut' | 'sound'];
  focus: [panelId: string];
  moveToView: [panel: DynamicPanel, view: 'cut' | 'sound'];
}>();

function onDragStart(event: DragEvent) {
  emit('dragStart', event, props.panel.id);
}

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
      ? t('fastcat.dynamicPanels.moveToCutWindow', 'Move to edit window')
      : t('fastcat.dynamicPanels.moveToSoundWindow', 'Move to sound window');

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
        label: t('common.close', 'Close'),
        icon: 'i-heroicons-x-mark',
        onSelect: onClose,
      },
    ],
  ];
});

const detachedStaticPanelContextMenuItems = computed(() => {
  if (!['history', 'effects', 'fileManager'].includes(props.panel.type)) {
    return [];
  }

  return [
    [
      {
        label: t('fastcat.dynamicPanels.returnToProjectPanel', 'Return to project panel'),
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
    @panel-drag-start="onDragStart"
  />
  <PropertiesPanel
    v-else-if="panel.type === 'properties'"
    class="h-full"
    :use-external-focus="true"
    @panel-drag-start="onDragStart"
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
      @drag-start="onDragStart"
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
      @drag-start="onDragStart"
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
      @drag-start="onDragStart"
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
      @drag-start="onDragStart"
      @close="onClose"
    />
    <div class="flex-1 overflow-hidden min-h-0">
      <ProjectEffects class="h-full" />
    </div>
  </div>
  <div
    v-else-if="panel.type === 'fileManager'"
    class="h-full w-full bg-ui-bg-elevated flex flex-col relative border border-ui-border"
  >
    <EditorPanelHeader
      :title="t('fastcat.dynamicPanels.projectFiles', 'Project files')"
      icon="i-heroicons-folder"
      :context-menu-items="detachedStaticPanelContextMenuItems"
      @drag-start="onDragStart"
      @close="onClose"
    />
    <div class="flex-1 overflow-hidden min-h-0">
      <Project class="h-full pt-2" :use-external-focus="true" />
    </div>
  </div>
</template>
