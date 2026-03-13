<script setup lang="ts">
import { computed, ref } from 'vue';
import AppButtonGroup from '~/components/ui/AppButtonGroup.vue';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import WheelNumberInput from '~/components/ui/WheelNumberInput.vue';
import Knob from '~/components/ui/Knob.vue';
import type {
  ButtonGroupParamControl,
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
  (e: 'action', action: string, key: string): void;
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

function getSelectItems(control: SelectParamControl | ButtonGroupParamControl) {
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

  return t('fastcat.hudClip.emptyLayer', 'Drop media here');
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
function handleAction(action: string, key: string) {
  emit('action', action, key);
}

function handleArrayAdd(control: any) {
  const current = Array.isArray(getValue(control.key)) ? [...getValue(control.key)] : [];
  current.push({ ...control.defaultItem });
  updateValue(control.key, current);
}

function handleArrayRemove(control: any, index: number) {
  const current = Array.isArray(getValue(control.key)) ? [...getValue(control.key)] : [];
  current.splice(index, 1);
  updateValue(control.key, current);
}

function handleArrayItemUpdate(control: any, index: number, itemKey: string, value: any) {
  const current = Array.isArray(getValue(control.key)) ? [...getValue(control.key)] : [];
  if (current[index]) {
    current[index] = { ...current[index], [itemKey]: value };
    updateValue(control.key, current);
  }
}
</script>

<template>
  <div :class="props.asContents ? 'contents' : 'flex flex-col gap-2'">
    <template
      v-for="control in visibleControls"
      :key="control.key ?? `${control.kind}-${getLabel(control)}`"
    >
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
                ? control.format(
                    Number(getValue(control.key) ?? control.defaultValue ?? control.min),
                  )
                : (getValue(control.key) ?? control.defaultValue ?? control.min)
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

      <div v-else-if="control.kind === 'knob'" class="flex flex-col items-center justify-center gap-1.5 py-1">
        <Knob
          :model-value="Number(getValue(control.key) ?? control.defaultValue ?? control.min)"
          :min="control.min"
          :max="control.max"
          :step="control.step"
          :default-value="control.defaultValue"
          :disabled="control.disabled"
          size="md"
          @update:model-value="(value: number) => updateValue(control.key, value)"
        />
        <div class="flex flex-col items-center text-[10px] leading-tight">
          <span class="text-ui-text-muted text-center">{{ getLabel(control) }}</span>
          <span class="font-mono text-ui-text">
            {{
              control.format
                ? control.format(
                    Number(getValue(control.key) ?? control.defaultValue ?? control.min),
                  )
                : (getValue(control.key) ?? control.defaultValue ?? control.min)
            }}
          </span>
        </div>
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
          @update:model-value="
            (value: unknown) => updateValue(control.key, normalizeSelectValue(value))
          "
        />
      </div>

      <div v-else-if="control.kind === 'button-group'" class="flex flex-col gap-1">
        <span class="text-xs text-ui-text-muted">{{ getLabel(control) }}</span>
        <AppButtonGroup
          :model-value="getValue(control.key)"
          :options="getSelectItems(control)"
          size="xs"
          :disabled="control.disabled"
          fluid
          @update:model-value="
            (value: unknown) => updateValue(control.key, normalizeSelectValue(value))
          "
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
          @update:model-value="
            (value: string | number) => updateValue(control.key, String(value ?? ''))
          "
        />
        <UInput
          v-else
          :model-value="String(getValue(control.key) ?? '')"
          :placeholder="control.placeholder"
          :size="size"
          :disabled="control.disabled"
          @update:model-value="
            (value: string | number) => updateValue(control.key, String(value ?? ''))
          "
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

      <div v-else-if="control.kind === 'action'" class="flex flex-col gap-1">
        <UButton
          :icon="control.icon"
          :disabled="control.disabled"
          :size="size"
          color="white"
          variant="solid"
          class="justify-center w-full"
          @click="handleAction(control.action, control.key)"
        >
          {{
            control.buttonLabelKey
              ? t(control.buttonLabelKey)
              : (control.buttonLabel ?? getLabel(control))
          }}
        </UButton>
      </div>

      <div v-else-if="control.kind === 'array'" class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{ getLabel(control) }}</span>
          <UButton
            icon="i-heroicons-plus"
            size="2xs"
            color="primary"
            variant="soft"
            :disabled="control.disabled"
            @click="handleArrayAdd(control)"
          >
            {{ control.addLabelKey ? t(control.addLabelKey) : (control.addLabel ?? 'Add') }}
          </UButton>
        </div>

        <div
          v-if="!Array.isArray(getValue(control.key)) || getValue(control.key).length === 0"
          class="text-xs text-ui-text-muted text-center py-2 border border-dashed border-ui-border rounded"
        >
          {{ control.emptyLabelKey ? t(control.emptyLabelKey) : (control.emptyLabel ?? 'Empty') }}
        </div>

        <div v-else :class="['flex gap-2', control.layout === 'horizontal' ? 'flex-row overflow-x-auto pb-2 snap-x snap-mandatory' : 'flex-col']">
          <div
            v-for="(item, index) in getValue(control.key)"
            :key="index"
            class="flex flex-col gap-2 bg-ui-bg-elevated border border-ui-border rounded relative group shrink-0"
            :class="control.layout === 'horizontal' ? 'w-32 snap-center' : 'p-3'"
          >
            <div
              class="flex items-center justify-between border-b border-ui-border/50 bg-ui-bg-muted/50 rounded-t"
              :class="control.layout === 'horizontal' ? 'p-1.5' : 'pb-2 mb-1 -mx-3 -mt-3 px-3 pt-2'"
            >
              <span class="text-[10px] font-medium text-ui-text-muted uppercase tracking-wider">
                #{{ index + 1 }}
              </span>
              <UButton
                icon="i-heroicons-trash"
                size="2xs"
                color="red"
                variant="ghost"
                :disabled="control.disabled"
                class="opacity-0 group-hover:opacity-100 transition-opacity"
                @click="handleArrayRemove(control, index)"
              />
            </div>
            <div :class="['flex flex-col gap-2', control.layout === 'horizontal' ? 'p-2' : '']">
              <ParamsRenderer
                :controls="control.itemTemplate"
                :values="item"
                :size="size"
                as-contents
                @update:value="(key, value) => handleArrayItemUpdate(control, index, key, value)"
              />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
