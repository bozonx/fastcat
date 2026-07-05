<script setup lang="ts">
import { computed } from 'vue';
import type { EffectManifest } from '~/effects';

const props = defineProps<{
  manifest?:
    | Partial<EffectManifest<Record<string, unknown>>>
    | {
        name?: string;
        nameKey?: string;
        icon?: string;
        description?: string;
        descriptionKey?: string;
        target?: string;
      };
  title?: string;
  icon?: string;
  description?: string;
  isSelected?: boolean;
  isDraggable?: boolean;
  showAction?: boolean;
  showRename?: boolean;
  showDefaultStar?: boolean;
  isDefault?: boolean;
  showDragHandle?: boolean;
  actionIcon?: string;
  actionColor?: string;
}>();

const { t } = useI18n();

const emit = defineEmits<{
  click: [];
  action: [];
  rename: [];
  'toggle-default': [];
  'pointer-down': [event: PointerEvent];
}>();

const cardTitle = computed(() => {
  if (props.title !== undefined) return props.title;
  if (!props.manifest) return '';
  return props.manifest.nameKey ? t(props.manifest.nameKey) : props.manifest.name || '';
});

const cardIcon = computed(() => {
  if (props.icon !== undefined) return props.icon;
  return props.manifest?.icon || 'i-heroicons-document-text';
});

const cardDescription = computed(() => {
  if (props.description !== undefined) return props.description;
  if (!props.manifest) return undefined;
  return props.manifest.descriptionKey
    ? t(props.manifest.descriptionKey)
    : props.manifest.description;
});

function onPointerDown(e: PointerEvent) {
  const target = e.target as HTMLElement | null;
  if (target?.closest('button')) {
    return;
  }
  if (props.isDraggable) {
    emit('pointer-down', e);
  }
}
</script>

<template>
  <div
    class="effect-card flex items-center gap-2 px-2.5 py-1.5 rounded border transition-colors group relative select-none"
    :class="[
      isSelected
        ? 'border-primary bg-primary/10 text-ui-text font-medium'
        : 'border-ui-border/60 bg-ui-bg-muted/40 hover:bg-ui-bg-muted hover:border-ui-border',
      isDraggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
    ]"
    @pointerdown="onPointerDown"
    @click="emit('click')"
  >
    <UIcon :name="cardIcon" class="w-4 h-4 text-primary shrink-0" />

    <div class="flex-1 min-w-0 flex items-center gap-1.5">
      <div
        v-if="showDragHandle"
        class="drag-handle w-3.5 h-3.5 text-ui-text-muted hover:text-ui-text cursor-grab active:cursor-grabbing shrink-0"
      >
        <UIcon name="i-heroicons-bars-3" class="w-3.5 h-3.5" />
      </div>

      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-1.5">
          <h4 class="text-xs font-medium text-ui-text truncate leading-snug">
            {{ cardTitle }}
          </h4>
          <div
            v-if="showDefaultStar || showRename || showAction"
            class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          >
            <UButton
              v-if="showDefaultStar"
              :icon="isDefault ? 'i-heroicons-star-solid' : 'i-heroicons-star'"
              :color="isDefault ? 'yellow' : 'neutral'"
              variant="ghost"
              size="xs"
              :title="t('fastcat.library.texts.setAsDefault')"
              class="p-0.5"
              @click.stop="emit('toggle-default')"
            />
            <UButton
              v-if="showRename"
              icon="i-heroicons-pencil-square"
              color="neutral"
              variant="ghost"
              size="xs"
              :title="t('common.rename')"
              class="p-0.5"
              @click.stop="emit('rename')"
            />
            <UButton
              v-if="showAction"
              :icon="actionIcon || 'i-heroicons-trash'"
              :color="actionColor || 'red'"
              variant="ghost"
              size="xs"
              class="p-0.5"
              @click.stop="emit('action')"
            />
          </div>
        </div>
        <p
          v-if="(manifest?.target === 'audio' || description) && cardDescription"
          class="text-2xs text-ui-text-muted mt-0.5 line-clamp-1 leading-tight"
          :title="cardDescription"
        >
          {{ cardDescription }}
        </p>
      </div>
    </div>

    <div
      v-if="!showDefaultStar && !showRename && !showAction && !isDraggable"
      class="shrink-0 flex items-center self-center"
    >
      <UIcon
        name="i-heroicons-plus-circle"
        class="w-4 h-4 text-ui-text-muted opacity-0 group-hover:opacity-100 transition-opacity"
      />
    </div>
  </div>
</template>
