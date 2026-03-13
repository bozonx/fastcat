<script setup lang="ts">
import { Pane, Splitpanes } from 'splitpanes';
import ExportForm from '~/components/export/ExportForm.vue';
import MonitorContainer from '~/components/monitor/MonitorContainer.vue';

interface Props {
  sizes: number[];
}

defineProps<Props>();

const emit = defineEmits<{
  resized: [event: { panes: Array<{ size: number }> }];
}>();
</script>

<template>
  <Splitpanes
    class="editor-splitpanes"
    @resized="(event: { panes: Array<{ size: number }> }) => emit('resized', event)"
  >
    <Pane :size="sizes[0]" min-size="20">
      <ExportForm class="h-full" />
    </Pane>
    <Pane :size="sizes[1]" min-size="20">
      <MonitorContainer class="h-full" />
    </Pane>
  </Splitpanes>
</template>
