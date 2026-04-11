<script setup lang="ts">
import { Pane, Splitpanes } from 'splitpanes';
import AudioMixer from '~/components/audio/AudioMixer.vue';
import EditorDynamicPanelsView from '~/components/editor/EditorDynamicPanelsView.vue';
import type { PanelFocusId } from '~/stores/focus.store';
import type { DynamicPanel, PanelColumn } from '~/stores/editor-view.store';

interface SplitResizeEvent {
  panes: Array<{ size: number }>;
}

interface Props {
  sizes: number[];
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
}

defineProps<Props>();

const emit = defineEmits<{
  resized: [event: SplitResizeEvent];
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
  moveToView: [panel: DynamicPanel, view: 'cut' | 'sound'];
  topReset: [view: 'cut' | 'sound'];
  verticalReset: [colId: string, view: 'cut' | 'sound'];
}>();

import { useFileManagerStore } from '~/stores/file-manager.store';
import { provide } from 'vue';

provide('fileManagerStore', useFileManagerStore());
</script>

<template>
  <Splitpanes
    class="editor-splitpanes"
    @resized="(event: SplitResizeEvent) => emit('resized', event)"
  >
    <Pane :size="sizes[0]" min-size="10">
      <AudioMixer />
    </Pane>
    <Pane :size="sizes[1]" min-size="10">
      <EditorDynamicPanelsView
        left-panel-type="files"
        right-panel-type="monitor"
        view="sound"
        :columns="columns"
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
        @move-to-view="(panel, view) => emit('moveToView', panel, view)"
        @top-reset="(view) => emit('topReset', view)"
        @vertical-reset="(colId, view) => emit('verticalReset', colId, view)"
      />
    </Pane>
  </Splitpanes>
</template>
