<script setup lang="ts">
import { Pane, Splitpanes } from 'splitpanes';
import AudioMixer from '~/components/audio/AudioMixer.vue';
import EditorDynamicPanelsView from '~/components/editor/EditorDynamicPanelsView.vue';
import type { PanelFocusId } from '~/stores/focus.store';
import type { PanelColumn } from '~/stores/editor-view.store';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { provide } from 'vue';
import type { EditorPanelEvents, SplitResizeEvent } from '~/types/editor-panels';
import { createEditorPanelEventListeners } from '~/utils/editor-panels';

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
  panelDndZoneAttrs: Record<string, string>;
}

interface SoundViewEvents extends EditorPanelEvents {
  resized: [event: SplitResizeEvent];
}

defineProps<Props>();

const emit = defineEmits<SoundViewEvents>();
const panelListeners = createEditorPanelEventListeners(emit);

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
        :panel-dnd-zone-attrs="panelDndZoneAttrs"
        v-on="panelListeners"
      />
    </Pane>
  </Splitpanes>
</template>
