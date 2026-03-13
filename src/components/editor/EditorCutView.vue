<script setup lang="ts">
import EditorDynamicPanelsView from '~/components/editor/EditorDynamicPanelsView.vue';
import type { PanelFocusId } from '~/stores/focus.store';
import type { DynamicPanel, PanelColumn } from '~/stores/editorView.store';

interface SplitResizeEvent {
  panes: Array<{ size: number }>;
}

interface Props {
  columns: PanelColumn[];
  layoutKey: string;
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
}

defineProps<Props>();

const emit = defineEmits<{
  topResize: [event: SplitResizeEvent];
  verticalResize: [
    event: SplitResizeEvent | Array<{ size: number }>,
    colId: string,
    view: 'cut' | 'sound',
  ];
  dragStart: [event: DragEvent, panelId: string];
  dragOver: [event: DragEvent, panelId: string, view: 'cut' | 'sound'];
  dragLeave: [event: DragEvent, panelId: string];
  drop: [event: DragEvent, panelId: string, view: 'cut' | 'sound'];
  dragEnd: [];
  focus: [panelId: string];
  close: [panel: DynamicPanel, view: 'cut' | 'sound'];
}>();
</script>

<template>
  <EditorDynamicPanelsView
    view="cut"
    :columns="columns"
    :layout-key="layoutKey"
    :top-sizes="topSizes"
    :dragging-panel-id="draggingPanelId"
    :drag-over-panel-id="dragOverPanelId"
    :drop-position="dropPosition"
    :get-vertical-size="getVerticalSize"
    :is-focused="isFocused"
    :get-focus-id="getFocusId"
    @top-resize="(event) => emit('topResize', event)"
    @vertical-resize="(event, colId, view) => emit('verticalResize', event, colId, view)"
    @drag-start="(event, panelId) => emit('dragStart', event, panelId)"
    @drag-over="(event, panelId, view) => emit('dragOver', event, panelId, view)"
    @drag-leave="(event, panelId) => emit('dragLeave', event, panelId)"
    @drop="(event, panelId, view) => emit('drop', event, panelId, view)"
    @drag-end="emit('dragEnd')"
    @focus="(panelId) => emit('focus', panelId)"
    @close="(panel, view) => emit('close', panel, view)"
  />
</template>
