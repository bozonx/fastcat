<script setup lang="ts">
import { computed, ref } from 'vue';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
import type {
  FileParamControl,
  ParamControl,
  ParamOption,
  SelectParamControl,
} from '~/components/properties/params';

const props = withDefaults(
  defineProps<{
    controls: ParamControl[];
    values: Record<string, any>;
    size?: 'xs' | 'sm' | 'md';
    asContents?: boolean;
  }>(),
  {
    asContents: false,
    size: 'sm',
  },
);

const emit = defineEmits<{
  (e: 'update:value', key: string, value: any): void;
}>();

const { t } = useI18n();

const dragOverKey = ref<string | null>(null);

const visibleControls = computed(() =>
  props.controls.filter((control) => !control.showIf || control.showIf(props.values)),
);

function getLabel(control: ParamControl): string {
  if ('label' in control && typeof control.label === 'string') {
    return control.label;
  }

  if ('labelKey' in control && typeof control.labelKey === 'string') {
    return t(control.labelKey);
  }

  return '';
}

function getValue(key: string | undefined): any {
  if (!key) return undefined;
  return props.values[key];
}

function updateValue(key: string | undefined, value: any) {
  if (!key) return;
  emit('update:value', key, value);
}

function normalizeSelectValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (!value || typeof value !== 'object') return undefined;
  if ('value' in value) {
    return (value as { value?: string | number | boolean }).value;
  }

  return undefined;
}

function getSelectItems(control: SelectParamControl) {
  return control.options.map((option: ParamOption) => ({
    value: option.value,
    label:
      typeof option.label === 'string'
        ? option.label
        : typeof option.labelKey === 'string'
          ? t(option.labelKey)
          : String(option.value),
  }));
}

function getDisplayFileValue(control: FileParamControl): string {
  const value = getValue(control.key);
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (typeof control.emptyLabel === 'string') {
    return control.emptyLabel;
  }

  if (typeof control.emptyLabelKey === 'string') {
    return t(control.emptyLabelKey);
  }

  return t('granVideoEditor.hudClip.emptyLayer', 'Drop media here');
}

function handleFileDrop(event: DragEvent, control: FileParamControl) {
  dragOverKey.value = null;
  const raw = event.dataTransfer?.getData('application/json');
  if (!raw) return;

  try {
    const item = JSON.parse(raw);
    if (item.kind === 'file' && typeof item.path === 'string' && item.path) {
      updateValue(control.key, item.path);
    }
  } catch {
    return;
  }
}
</script>

<template>
  <div :class="props.asContents ? 'contents' : 'flex flex-col gap-2'">
    <template v-for="control in visibleControls" :key="control.key ?? `${control.kind}-${getLabel(control)}`">
      <div
        v-if="control.kind === 'row'"
        class="grid gap-2"
        :class="control.columns === 1 ? 'grid-cols-1' : 'grid-cols-2'"
      >
        <ParamsRenderer
          :controls="control.controls"
          :values="values"
          :size="size"
          as-contents
          @update:value="(key, value) => updateValue(key, value)"
        />
      </div>

      <div v-else-if="control.kind === 'slider'" class="flex flex-col gap-1">
        <div class="flex justify-between text-xs text-ui-text-muted gap-2">
          <span>{{ getLabel(control) }}</span>
          <span>
            {{
              control.format
                ? control.format(Number(getValue(control.key) ?? control.defaultValue ?? control.min))
                : getValue(control.key) ?? control.defaultValue ?? control.min
            }}
          </span>
        </div>
        <WheelSlider
          :model-value="Number(getValue(control.key) ?? control.defaultValue ?? control.min)"
          :min="control.min"
          :max="control.max"
          :step="control.step"
          :default-value="control.defaultValue"
          :disabled="control.disabled"
          @update:model-value="(value: number) => updateValue(control.key, value)"
        />
      </div>

      <div v-else-if="control.kind === 'number'" class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{ getLabel(control) }}</span>
        <WheelNumberInput
          :model-value="Number(getValue(control.key) ?? control.defaultValue ?? 0)"
          :size="size"
          :min="control.min"
          :max="control.max"
          :step="control.step ?? 1"
          :disabled="control.disabled"
          @update:model-value="(value: number) => updateValue(control.key, Number(value))"
        />
      </div>

      <div
        v-else-if="control.kind === 'toggle' || control.kind === 'boolean'"
        class="flex items-center justify-between gap-3"
      >
        <span class="text-xs text-ui-text-muted">{{ getLabel(control) }}</span>
        <USwitch
          :model-value="Boolean(getValue(control.key))"
          size="sm"
          :disabled="control.disabled"
          @update:model-value="(value: boolean) => updateValue(control.key, value)"
        />
      </div>

      <div v-else-if="control.kind === 'select'" class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{ getLabel(control) }}</span>
        <USelectMenu
          :model-value="getValue(control.key)"
          :items="getSelectItems(control)"
          value-key="value"
          label-key="label"
          :size="size"
          :disabled="control.disabled"
          @update:model-value="(value: unknown) => updateValue(control.key, normalizeSelectValue(value))"
        />
      </div>

      <div v-else-if="control.kind === 'color'" class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{ getLabel(control) }}</span>
        <UColorPicker
          :model-value="String(getValue(control.key) ?? '#000000')"
          format="hex"
          :size="size"
          :disabled="control.disabled"
          @update:model-value="(value: unknown) => updateValue(control.key, String(value ?? ''))"
        />
      </div>

      <div v-else-if="control.kind === 'text'" class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{ getLabel(control) }}</span>
        <UTextarea
          v-if="control.multiline"
          :model-value="String(getValue(control.key) ?? '')"
          :rows="control.rows ?? 4"
          :placeholder="control.placeholder"
          :size="size"
          :disabled="control.disabled"
          @update:model-value="(value: string | number) => updateValue(control.key, String(value ?? ''))"
        />
        <UInput
          v-else
          :model-value="String(getValue(control.key) ?? '')"
          :placeholder="control.placeholder"
          :size="size"
          :disabled="control.disabled"
          @update:model-value="(value: string | number) => updateValue(control.key, String(value ?? ''))"
        />
      </div>

      <div v-else-if="control.kind === 'file'" class="flex flex-col gap-1">
        <span class="text-xs text-ui-text-muted">{{ getLabel(control) }}</span>
        <div
          class="flex items-center gap-2 p-2 rounded border border-dashed transition-colors"
          :class="
            dragOverKey === control.key
              ? 'border-primary-500 bg-primary-500/10'
              : 'border-ui-border bg-ui-bg-muted'
          "
          @dragover.prevent="dragOverKey = control.key"
          @dragleave.prevent="dragOverKey = dragOverKey === control.key ? null : dragOverKey"
          @drop.prevent="handleFileDrop($event, control)"
        >
          <div class="flex-1 min-w-0 flex items-center gap-2">
            <UIcon
              :name="control.icon ?? 'i-heroicons-document'"
              class="w-4 h-4 text-ui-text-muted shrink-0"
            />
            <span class="text-xs text-ui-text truncate">{{ getDisplayFileValue(control) }}</span>
          </div>
          <UButton
            v-if="getValue(control.key) && !control.disabled"
            icon="i-heroicons-x-mark"
            size="2xs"
            color="gray"
            variant="ghost"
            @click="updateValue(control.key, undefined)"
          />
        </div>
      </div>
    </template>
  </div>
</template>
