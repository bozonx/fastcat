<script setup lang="ts">
import { Pane, Splitpanes } from 'splitpanes';
import EditorDynamicPanelContent from '~/components/editor/EditorDynamicPanelContent.vue';
import type { PanelFocusId } from '~/stores/focus.store';
import type { DynamicPanel, PanelColumn } from '~/stores/editor-view.store';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';
import { ref, computed } from 'vue';

interface SplitResizeEvent {
  panes: Array<{ size: number }>;
}

interface Props {
  view: 'cut' | 'sound';
  columns: PanelColumn[];
  layoutKey: string;
  topSizes: number[];
  getVerticalSize: (
    colId: string,
    rowIndex: number,
    totalRows: number,
    view?: 'cut' | 'sound',
  ) => number | undefined;
  draggingPanelId: string | null;
  dragOverPanelId: string | null;
  dropPosition: 'left' | 'right' | 'top' | 'bottom' | null;
  isFocused: (panelId: string) => boolean;
  getFocusId: (panelId: string) => PanelFocusId;
  leftPanelType: 'files' | 'settings' | 'export';
  rightPanelType: 'monitor' | 'properties';
}

const props = defineProps<Props>();

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
  moveToView: [panel: DynamicPanel, view: 'cut' | 'sound'];
  topReset: [view: 'cut' | 'sound'];
  verticalReset: [colId: string, view: 'cut' | 'sound'];
}>();

const { t } = useI18n();
const menuRef = ref<InstanceType<typeof UiContextMenuPortal> | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const activeColId = ref<string | null>(null);

function onContextMenu(event: MouseEvent, colId: string | null) {
  const target = event.target as HTMLElement;
  if (target.classList.contains('splitpanes__splitter')) {
    event.preventDefault();
    activeColId.value = colId;
    menuRef.value?.open(event);
  }
}

const splitterMenuItems = computed(() => [
  [
    {
      label: t('common.reset'),
      icon: 'i-heroicons-arrow-path',
      onSelect: () => {
        if (activeColId.value) {
          emit('verticalReset', activeColId.value, props.view);
        } else {
          emit('topReset', props.view);
        }
      },
    },
  ],
]);
</script>

<template>
  <div ref="containerRef" class="h-full">
    <UiContextMenuPortal 
      ref="menuRef" 
      :items="splitterMenuItems" 
      :target-el="containerRef" 
      manual 
    />
    <Splitpanes
      :key="layoutKey"
      class="editor-splitpanes"
      @resized="(event: SplitResizeEvent) => emit('topResize', event)"
      @contextmenu="onContextMenu($event, null)"
    >
      <Pane
        v-for="(col, colIndex) in columns"
        :key="col.id"
        :size="topSizes[colIndex] ?? 100 / columns.length"
        min-size="5"
      >
        <Splitpanes
          :key="`${col.id}-${col.panels.map((panel) => panel.id).join('|')}`"
          horizontal
          class="editor-splitpanes"
          @resized="(event: SplitResizeEvent) => emit('verticalResize', event, col.id, view)"
          @contextmenu.stop.prevent="onContextMenu($event, col.id)"
        >
          <Pane
            v-for="(panel, rowIndex) in col.panels"
            :key="panel.id"
            :size="
              getVerticalSize(col.id, rowIndex, col.panels.length, view) ?? 100 / col.panels.length
            "
            min-size="5"
          >
            <div
              class="panel-focus-frame h-full w-full relative transition-all duration-200"
              :class="{
                'opacity-50': draggingPanelId === panel.id,
                'border-l-2 border-l-primary-500':
                  dragOverPanelId === panel.id && dropPosition === 'left',
                'border-r-2 border-r-primary-500':
                  dragOverPanelId === panel.id && dropPosition === 'right',
                'border-t-2 border-t-primary-500':
                  dragOverPanelId === panel.id && dropPosition === 'top',
                'border-b-2 border-b-primary-500':
                  dragOverPanelId === panel.id && dropPosition === 'bottom',
                'panel-focus-frame--active': isFocused(panel.id),
              }"
              @click.stop="emit('focus', panel.id)"
              @dragenter.prevent
              @dragover.prevent="(event) => emit('dragOver', event, panel.id, view)"
              @dragleave="(event) => emit('dragLeave', event, panel.id)"
              @drop.prevent="(event) => emit('drop', event, panel.id, view)"
              @dragend="emit('dragEnd')"
            >
              <EditorDynamicPanelContent
                :panel="panel"
                :view="view"
                :focus-panel-id="getFocusId(panel.id)"
                @drag-start="(event, panelId) => emit('dragStart', event, panelId)"
                @focus="(panelId) => emit('focus', panelId)"
                @close="(targetPanel, targetView) => emit('close', targetPanel, targetView)"
                @move-to-view="
                  (targetPanel, targetView) => emit('moveToView', targetPanel, targetView)
                "
              />
            </div>
          </Pane>
        </Splitpanes>
      </Pane>
    </Splitpanes>
  </div>
</template>
