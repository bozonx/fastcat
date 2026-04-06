<script setup lang="ts">
import { computed, ref } from 'vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiKnob from '~/components/ui/editor/UiKnob.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import type {
  ArrayParamControl,
  ButtonGroupParamControl,
  FileParamControl,
  ParamControl,
  ParamOption,
  ScaleXYParamControl,
  SelectParamControl,
} from '~/components/properties/params';

const props = withDefaults(
  defineProps<{
    controls: ParamControl[];
    values: Record<string, unknown>;
    size?: 'xs' | 'sm' | 'md';
    asContents?: boolean;
    forceFullWidth?: boolean;
    disabled?: boolean;
  }>(),
  {
    asContents: false,
    forceFullWidth: false,
    disabled: false,
    size: 'sm',
  },
);

const emit = defineEmits<{
  (e: 'update:value', key: string, value: unknown): void;
  (e: 'action', action: string, key: string): void;
}>();

const { t } = useI18n();

const dragOverKey = ref<string | null>(null);

const visibleControls = computed(() =>
  props.controls.filter(
    (control) => !control.showIf || control.showIf(props.values as Record<string, any>),
  ),
);

interface ScaleXYControlState {
  canReset: boolean;
  isLinked: boolean;
  label: string;
  xValue: number;
  yLabel: string;
  yValue: number;
}

interface VisibleControlState {
  arrayItemsByControl: Map<ArrayParamControl, Record<string, unknown>[]>;
  scaleXYStateByControl: Map<ScaleXYParamControl, ScaleXYControlState>;
  selectItemsByControl: Map<
    SelectParamControl | ButtonGroupParamControl,
    ReturnType<typeof getSelectItems>
  >;
}

function getLabel(control: ParamControl): string {
  if ('labelKey' in control && typeof control.labelKey === 'string') {
    return t(control.labelKey);
  }

  if ('label' in control && typeof control.label === 'string') {
    return control.label;
  }

  return '';
}

function getValue(key: string | undefined): unknown {
  if (!key) return undefined;
  return props.values[key];
}

function updateValue(key: string | undefined, value: unknown) {
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
      typeof option.labelKey === 'string'
        ? t(option.labelKey)
        : typeof option.label === 'string'
          ? option.label
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
  if (!raw) {
    // Fallback: Check for files in event.dataTransfer.files
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      // Assuming we need a path, but browser drag and drop doesn't always give full path.
      // In electron/tauri it might.
      const file = files[0] as any;
      if (file && file.path) {
        updateValue(control.key, file.path);
      }
    }
    return;
  }

  try {
    const item = JSON.parse(raw);
    if (item && typeof item.path === 'string' && item.path) {
      updateValue(control.key, item.path);
      if (control.kindKey) {
        const sourceKind = item.kind === 'timeline' ? 'timeline' : 'media';
        updateValue(control.kindKey, sourceKind);
      }
    }
  } catch {
    return;
  }
}
function handleAction(action: string, key: string) {
  emit('action', action, key);
}

const visibleControlState = computed<VisibleControlState>(() => {
  const arrayItemsByControl = new Map<ArrayParamControl, Record<string, unknown>[]>();
  const scaleXYStateByControl = new Map<ScaleXYParamControl, ScaleXYControlState>();
  const selectItemsByControl = new Map<
    SelectParamControl | ButtonGroupParamControl,
    ReturnType<typeof getSelectItems>
  >();

  for (const control of visibleControls.value) {
    if (control.kind === 'array') {
      const value = getValue(control.key);
      arrayItemsByControl.set(
        control,
        Array.isArray(value) ? (value as Record<string, unknown>[]) : [],
      );
      continue;
    }

    if (control.kind === 'scale-xy') {
      const isLinked = Boolean(getValue(control.keyLinked) ?? control.defaultLinked ?? true);
      const xValue = Number(getValue(control.keyX) ?? control.defaultValueX ?? 100);
      const yValue = Number(getValue(control.keyY) ?? control.defaultValueY ?? 100);

      scaleXYStateByControl.set(control, {
        isLinked,
        xValue,
        yValue,
        label: isLinked
          ? control.labelKey
            ? t(control.labelKey)
            : 'Scale'
          : control.labelXKey
            ? t(control.labelXKey)
            : 'Scale X',
        yLabel: control.labelYKey ? t(control.labelYKey) : 'Scale Y',
        canReset: isLinked ? xValue !== 100 : xValue !== 100 || yValue !== 100,
      });
      continue;
    }

    if (control.kind === 'select' || control.kind === 'button-group') {
      selectItemsByControl.set(control, getSelectItems(control));
    }
  }

  return {
    arrayItemsByControl,
    scaleXYStateByControl,
    selectItemsByControl,
  };
});

function getScaleXYState(control: ScaleXYParamControl): ScaleXYControlState {
  return (
    visibleControlState.value.scaleXYStateByControl.get(control) ?? {
      isLinked: true,
      xValue: 100,
      yValue: 100,
      label: control.labelKey ? t(control.labelKey) : 'Scale',
      yLabel: control.labelYKey ? t(control.labelYKey) : 'Scale Y',
      canReset: false,
    }
  );
}

function getArrayItems(control: ArrayParamControl): Record<string, unknown>[] {
  return visibleControlState.value.arrayItemsByControl.get(control) ?? [];
}

function getCachedSelectItems(control: SelectParamControl | ButtonGroupParamControl) {
  return visibleControlState.value.selectItemsByControl.get(control) ?? [];
}

function handleArrayAdd(control: ParamControl) {
  if (control.kind !== 'array') return;
  const current = Array.isArray(getValue(control.key)) ? [...(getValue(control.key) as any[])] : [];
  current.push({ ...control.defaultItem });
  updateValue(control.key, current);
}

function handleArrayRemove(control: ParamControl, index: number) {
  if (control.kind !== 'array') return;
  const current = Array.isArray(getValue(control.key)) ? [...(getValue(control.key) as any[])] : [];
  current.splice(index, 1);
  updateValue(control.key, current);
}

function handleArrayItemUpdate(
  control: ParamControl,
  index: number,
  itemKey: string,
  value: unknown,
) {
  if (control.kind !== 'array') return;
  const current = Array.isArray(getValue(control.key)) ? [...(getValue(control.key) as any[])] : [];
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
          :force-full-width="!!(control.kind === 'row' && control.columns && control.columns > 1)"
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
        <UiWheelSlider
          :model-value="Number(getValue(control.key) ?? control.defaultValue ?? control.min)"
          :min="control.min"
          :max="control.max"
          :step="control.step"
          :default-value="control.defaultValue"
          :disabled="control.disabled || props.disabled"
          @update:model-value="(value: number) => updateValue(control.key, value)"
        />
      </div>

      <div
        v-else-if="control.kind === 'knob'"
        class="flex flex-col items-center justify-center gap-1.5 py-1"
      >
        <UiKnob
          :model-value="Number(getValue(control.key) ?? control.defaultValue ?? control.min)"
          :min="control.min"
          :max="control.max"
          :step="control.step"
          :default-value="control.defaultValue"
          :disabled="control.disabled || props.disabled"
          size="md"
          @update:model-value="(value: number) => updateValue(control.key, value)"
        />
        <div class="flex flex-col items-center text-2xs leading-tight">
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
        <UiWheelNumberInput
          :model-value="Number(getValue(control.key) ?? control.defaultValue ?? 0)"
          :size="size"
          :min="control.min"
          :max="control.max"
          :step="control.step ?? 1"
          :disabled="control.disabled || props.disabled"
          :full-width="props.forceFullWidth"
          @update:model-value="(value: number) => updateValue(control.key, Number(value))"
        />
      </div>

      <div v-else-if="control.kind === 'scale-xy'" class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span
            class="flex-1 text-xs text-ui-text-muted"
            :class="[getScaleXYState(control).isLinked ? 'cursor-pointer' : 'cursor-default']"
          >
            {{ getScaleXYState(control).label }}
          </span>
          <UButton
            v-if="getScaleXYState(control).canReset"
            icon="i-heroicons-arrow-path"
            size="2xs"
            variant="ghost"
            color="gray"
            class="opacity-50 hover:opacity-100 transition-opacity"
            @click="
              () => {
                updateValue(control.keyX, control.defaultValueX ?? 100);
                setTimeout(() => {
                  updateValue(control.keyY, control.defaultValueY ?? 100);
                }, 10);
              }
            "
          />
        </div>
        <div class="flex items-center gap-2">
          <UiWheelNumberInput
            class="flex-1"
            :model-value="getScaleXYState(control).xValue"
            :size="size"
            :min="control.min"
            :max="control.max"
            :step="control.step ?? 1"
            :disabled="control.disabled || props.disabled"
            full-width
            @update:model-value="
              (value: number) => {
                const numValue = Number(value);
                updateValue(control.keyX, numValue);
                if (getScaleXYState(control).isLinked) {
                  setTimeout(() => {
                    updateValue(control.keyY, numValue);
                  }, 10);
                }
              }
            "
          />
          <UButton
            size="xs"
            variant="ghost"
            color="gray"
            :icon="
              getScaleXYState(control).isLinked ? 'i-heroicons-link' : 'i-heroicons-link-slash'
            "
            :class="[getScaleXYState(control).isLinked ? 'text-ui-primary' : 'text-ui-text-muted']"
            @click="
              () => {
                const isLinked = !getScaleXYState(control).isLinked;
                updateValue(control.keyLinked, isLinked);
                if (isLinked) {
                  setTimeout(() => {
                    updateValue(control.keyY, getScaleXYState(control).xValue);
                  }, 10);
                }
              }
            "
          />
        </div>
        <div v-if="!getScaleXYState(control).isLinked" class="flex flex-col gap-0.5 mt-2">
          <span class="text-xs text-ui-text-muted">{{ getScaleXYState(control).yLabel }}</span>
          <UiWheelNumberInput
            :model-value="getScaleXYState(control).yValue"
            :size="size"
            :min="control.min"
            :max="control.max"
            :step="control.step ?? 1"
            :disabled="control.disabled || props.disabled"
            full-width
            @update:model-value="
              (value: number) => {
                const numValue = Number(value);
                updateValue(control.keyY, numValue);
                if (getScaleXYState(control).isLinked) {
                  setTimeout(() => {
                    updateValue(control.keyX, numValue);
                  }, 10);
                }
              }
            "
          />
        </div>
      </div>

      <div
        v-else-if="control.kind === 'toggle' || control.kind === 'boolean'"
        class="flex items-center justify-between gap-3"
      >
        <span class="text-xs text-ui-text-muted">{{ getLabel(control) }}</span>
        <USwitch
          :model-value="Boolean(getValue(control.key))"
          size="sm"
          :disabled="control.disabled || props.disabled"
          @update:model-value="(value: boolean) => updateValue(control.key, value)"
        />
      </div>

      <div v-else-if="control.kind === 'select'" class="flex flex-col gap-0.5">
        <span class="text-xs text-ui-text-muted">{{ getLabel(control) }}</span>
        <UiSelect
          :model-value="getValue(control.key) as any"
          :items="getCachedSelectItems(control)"
          value-key="value"
          label-key="label"
          :size="size"
          :disabled="control.disabled || props.disabled"
          @update:model-value="
            (value: unknown) => updateValue(control.key, normalizeSelectValue(value))
          "
        />
      </div>

      <div v-else-if="control.kind === 'button-group'" class="flex flex-col gap-1">
        <span class="text-xs text-ui-text-muted">{{ getLabel(control) }}</span>
        <UiButtonGroup
          :model-value="getValue(control.key)"
          :options="getCachedSelectItems(control)"
          size="xs"
          :disabled="control.disabled || props.disabled"
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
          :disabled="control.disabled || props.disabled"
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
          :disabled="control.disabled || props.disabled"
          @update:model-value="
            (value: string | number) => updateValue(control.key, String(value ?? ''))
          "
        />
        <UiTextInput
          v-else
          :model-value="String(getValue(control.key) ?? '')"
          :placeholder="control.placeholder"
          :size="size"
          :disabled="control.disabled || props.disabled"
          full-width
          @update:model-value="(value: string) => updateValue(control.key, String(value ?? ''))"
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
          @dragover.prevent.stop="dragOverKey = control.key"
          @dragleave.prevent.stop="dragOverKey = dragOverKey === control.key ? null : dragOverKey"
          @drop.prevent.stop="handleFileDrop($event, control)"
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
            @click="
              () => {
                updateValue(control.key, undefined);
                if (control.kindKey) updateValue(control.kindKey, undefined);
              }
            "
          />
        </div>
      </div>

      <div v-else-if="control.kind === 'action'" class="flex flex-col gap-1">
        <UButton
          :icon="control.icon"
          :disabled="control.disabled || props.disabled"
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
            :disabled="control.disabled || props.disabled"
            @click="handleArrayAdd(control)"
          >
            {{ control.addLabelKey ? t(control.addLabelKey) : (control.addLabel ?? 'Add') }}
          </UButton>
        </div>

        <div
          v-if="getArrayItems(control).length === 0"
          class="text-xs text-ui-text-muted text-center py-2 border border-dashed border-ui-border rounded"
        >
          {{ control.emptyLabelKey ? t(control.emptyLabelKey) : (control.emptyLabel ?? 'Empty') }}
        </div>

        <div
          v-else
          :class="[
            'flex gap-2',
            control.layout === 'horizontal'
              ? 'flex-row overflow-x-auto pb-2 snap-x snap-mandatory'
              : 'flex-col',
          ]"
        >
          <div
            v-for="(item, index) in getArrayItems(control)"
            :key="index"
            class="flex flex-col gap-2 bg-ui-bg-elevated border border-ui-border rounded relative group shrink-0"
            :class="control.layout === 'horizontal' ? 'w-32 snap-center' : 'p-3'"
          >
            <div
              class="flex items-center justify-between border-b border-ui-border/50 bg-ui-bg-muted/50 rounded-t"
              :class="control.layout === 'horizontal' ? 'p-1.5' : 'pb-2 mb-1 -mx-3 -mt-3 px-3 pt-2'"
            >
              <span class="text-2xs font-medium text-ui-text-muted uppercase tracking-wider">
                #{{ Number(index) + 1 }}
              </span>
              <UButton
                icon="i-heroicons-trash"
                size="2xs"
                color="red"
                variant="ghost"
                :disabled="control.disabled || props.disabled"
                class="opacity-0 group-hover:opacity-100 transition-opacity"
                @click="handleArrayRemove(control, Number(index))"
              />
            </div>
            <div :class="['flex flex-col gap-2', control.layout === 'horizontal' ? 'p-2' : '']">
              <ParamsRenderer
                :controls="control.itemTemplate"
                :values="item"
                :size="size"
                as-contents
                @update:value="
                  (key, value) => handleArrayItemUpdate(control, Number(index), key, value)
                "
              />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
