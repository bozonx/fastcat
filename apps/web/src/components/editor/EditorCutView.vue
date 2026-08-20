<script setup lang="ts">
import EditorDynamicPanelsView from '~/components/editor/EditorDynamicPanelsView.vue';
import type { PanelFocusId } from '~/stores/focus.store';
import type { PanelColumn } from '~/stores/editor-view.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { provide } from 'vue';
import type { EditorPanelEvents } from '~/types/editor-panels';
import { createEditorPanelEventListeners } from '~/utils/editor-panels';

interface Props {
  embedded?: boolean;
  columns: PanelColumn[];
  topSizes: number[];
  draggingPanelId: string | null;
  dragOverPanelId: string | null;
  dropPosition: 'left' | 'right' | 'top' | 'bottom' | null;
  getVerticalSize: (
    colId: string,
    rowIndex: number,
    totalRows: number,
    view?: 'cut' | 'sound',
  ) => number | undefined;
  isFocused: (panelId: string) => boolean;
  getFocusId: (panelId: string) => PanelFocusId;
  panelDndZoneAttrs: Record<string, string>;
}

defineProps<Props>();

const emit = defineEmits<EditorPanelEvents>();
const listeners = createEditorPanelEventListeners(emit);

provide('fileManagerStore', useFileManagerStore());
</script>

<template>
  <EditorDynamicPanelsView
    left-panel-type="files"
    right-panel-type="monitor"
    view="cut"
    :embedded="embedded"
    :columns="columns"
    :top-sizes="topSizes"
    :dragging-panel-id="draggingPanelId"
    :drag-over-panel-id="dragOverPanelId"
    :drop-position="dropPosition"
    :get-vertical-size="getVerticalSize"
    :is-focused="isFocused"
    :get-focus-id="getFocusId"
    :panel-dnd-zone-attrs="panelDndZoneAttrs"
    v-on="listeners"
  />
</template>
