<script setup lang="ts">
import { VueDraggable } from 'vue-draggable-plus';
import CollapsibleEffectGroup from '~/components/effects/CollapsibleEffectGroup.vue';
import EffectCard from '~/components/effects/EffectCard.vue';

export interface EffectCatalogItem {
  type: string;
  name?: string;
  nameKey?: string;
  icon?: string;
  description?: string;
  descriptionKey?: string;
  target?: string;
}

const isCollapsed = defineModel<boolean>('isCollapsed', { default: false });

const props = withDefaults(
  defineProps<{
    title: string;
    items: EffectCatalogItem[];
    emptyMessage?: string;
    selectedType?: string | null;
    draggable?: boolean;
    reorderable?: boolean;
    showActions?: boolean;
  }>(),
  {
    emptyMessage: undefined,
    selectedType: null,
    draggable: true,
    reorderable: false,
    showActions: false,
  },
);

const emit = defineEmits<{
  action: [item: EffectCatalogItem];
  pointerDown: [event: PointerEvent, item: EffectCatalogItem];
  rename: [item: EffectCatalogItem];
  select: [item: EffectCatalogItem];
  updateOrder: [items: EffectCatalogItem[]];
}>();

function handleUpdateOrder(items: unknown[]) {
  emit('updateOrder', items as EffectCatalogItem[]);
}
</script>

<template>
  <CollapsibleEffectGroup v-model:is-collapsed="isCollapsed" :title="props.title">
    <VueDraggable
      v-if="props.reorderable"
      :model-value="props.items"
      class="flex flex-col gap-1"
      :animation="150"
      ghost-class="opacity-50"
      filter="button"
      :prevent-on-filter="false"
      @update:model-value="handleUpdateOrder"
    >
      <EffectCard
        v-for="item in props.items"
        :key="item.type"
        :data-testid="`select-effect-${item.type}`"
        :manifest="item"
        :is-selected="props.selectedType === item.type"
        :is-draggable="props.draggable"
        :show-rename="props.showActions"
        :show-action="props.showActions"
        @pointer-down="emit('pointerDown', $event, item)"
        @click="emit('select', item)"
        @rename="emit('rename', item)"
        @action="emit('action', item)"
      />
    </VueDraggable>

    <div v-else class="grid grid-cols-1 gap-1">
      <EffectCard
        v-for="item in props.items"
        :key="item.type"
        :data-testid="`select-effect-${item.type}`"
        :manifest="item"
        :is-selected="props.selectedType === item.type"
        :is-draggable="props.draggable"
        @pointer-down="emit('pointerDown', $event, item)"
        @click="emit('select', item)"
      />
      <UiEmptyState
        v-if="props.items.length === 0 && props.emptyMessage"
        :message="props.emptyMessage"
      />
    </div>
  </CollapsibleEffectGroup>
</template>
