<script setup lang="ts">
import { computed, ref } from 'vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiKnob from '~/components/ui/editor/UiKnob.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiTextarea from '~/components/ui/UiTextarea.vue';
import UiColorBlendPicker from '~/components/ui/UiColorBlendPicker.vue';
import ClipAnimationStopwatchButton from '~/components/properties/clip/ClipAnimationStopwatchButton.vue';
import type {
  ButtonGroupParamControl,
  FileParamControl,
  ParamControl,
  ParamOption,
  ScaleXYParamControl,
  SelectParamControl,
} from '~/components/properties/params';

/**
 * Optional keyframe hooks. When supplied (clip video-effect editing), numeric
 * and boolean params get a stopwatch toggle; the parent decides how to seed /
 * record the keyframe and passes interpolated values back in through `values`.
 */
export interface ParamsKeyframeHooks {
  isKeyframable: (key: string, kind: string) => boolean;
  isAnimated: (key: string) => boolean;
  toggle: (key: string) => void;
}

export interface ParamsNumericInputRange {
  min: number;
  max: number;
}

const props = withDefaults(
  defineProps<{
    controls: ParamControl[];
    values: Record<string, unknown>;
    size?: 'xs' | 'sm' | 'md';
    asContents?: boolean;
    forceFullWidth?: boolean;
    disabled?: boolean;
    testIdPrefix?: string;
    keyframes?: ParamsKeyframeHooks;
    numericInputRanges?: Record<string, ParamsNumericInputRange>;
  }>(),
  {
    asContents: false,
    forceFullWidth: false,
    disabled: false,
    size: 'sm',
    testIdPrefix: undefined,
    keyframes: undefined,
    numericInputRanges: undefined,
  },
);

const emit = defineEmits<{
  (e: 'update:value', key: string, value: unknown): void;
  (e: 'action', action: string, key: string): void;
}>();

const { t } = useI18n();

const LINKED_SCALE_UPDATE_DELAY_MS = 10;

const dragOverKey = ref<string | null>(null);

function scheduleValueUpdate(key: string | undefined, value: unknown) {
  window.setTimeout(() => updateValue(key, value), LINKED_SCALE_UPDATE_DELAY_MS);
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

function getDisplayFileValue(control: FileParamControl | RenderableParamControl): string {
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

  return t('fastcat.hudClip.emptyLayer');
}

function handleFileDrop(event: DragEvent, control: RenderableParamControl) {
  dragOverKey.value = null;
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;

  const file = files[0] as File & { path?: string };
  if (file?.path) {
    updateValue(control.key, file.path);
  }
}
function buildScaleXYState(control: ScaleXYParamControl) {
  const isLinked = Boolean(getValue(control.keyLinked) ?? control.defaultLinked ?? true);
  const xValue = Number(getValue(control.keyX) ?? control.defaultValueX ?? 100);
  const yValue = Number(getValue(control.keyY) ?? control.defaultValueY ?? 100);

  return {
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
  };
}

interface RenderableParamControl {
  action?: string;
  addLabel?: string;
  addLabelKey?: string;
  buttonLabel?: string;
  buttonLabelKey?: string;
  columns?: 1 | 2;
  controls?: ParamControl[];
  defaultItem?: Record<string, unknown>;
  defaultLinked?: boolean;
  defaultValue?: number;
  defaultValueX?: number;
  defaultValueY?: number;
  disabled?: boolean;
  emptyLabel?: string;
  emptyLabelKey?: string;
  format?: (value: number) => string;
  icon?: string;
  itemTemplate?: ParamControl[];
  key?: string;
  keyLinked?: string;
  keyX?: string;
  keyY?: string;
  kind: ParamControl['kind'];
  kindKey?: string;
  label?: string;
  labelKey?: string;
  labelXKey?: string;
  labelYKey?: string;
  layout?: 'vertical' | 'horizontal';
  max?: number;
  min?: number;
  multiline?: boolean;
  placeholder?: string;
  rows?: number;
  step?: number;
  suffix?: string;
  displayMultiplier?: number;
}

interface VisibleControlEntry {
  actionLabel: string;
  arrayItems: Record<string, unknown>[];
  control: RenderableParamControl;
  disabled: boolean;
  fileDisplayValue: string;
  hasValue: boolean;
  key: string;
  kind: ParamControl['kind'];
  label: string;
  numberValue: number;
  scaleXYState: ReturnType<typeof buildScaleXYState> | null;
  selectItems: ReturnType<typeof getSelectItems>;
  stringValue: string;
  value: unknown;
}

function getArrayItems(control: RenderableParamControl): Record<string, unknown>[] {
  const value = getValue(control.key);
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

const visibleControlEntries = computed<VisibleControlEntry[]>(() => {
  const values = props.values as Record<string, unknown>;

  return props.controls
    .filter((control) => !control.showIf || control.showIf(values))
    .map((control) => {
      const label = getLabel(control);
      const rawValue = 'key' in control ? getValue(control.key) : undefined;

      let numberValue = 0;
      let stringValue = '';
      let selectItems: ReturnType<typeof getSelectItems> = [];
      let fileDisplayValue = '';
      let actionLabel = label;
      let arrayItems: Record<string, unknown>[] = [];
      let scaleXYState: ReturnType<typeof buildScaleXYState> | null = null;

      if (control.kind === 'slider' || control.kind === 'knob') {
        numberValue = Number(rawValue ?? control.defaultValue ?? control.min);
      } else if (control.kind === 'number') {
        let val = Number(rawValue ?? control.defaultValue ?? 0);
        if (control.displayMultiplier) {
          val = val * control.displayMultiplier;
        }
        numberValue = val;
      } else if (control.kind === 'scale-xy') {
        scaleXYState = buildScaleXYState(control);
      } else if (control.kind === 'select' || control.kind === 'button-group') {
        selectItems = getSelectItems(control);
      } else if (control.kind === 'color') {
        stringValue = String(rawValue ?? '#000000');
      } else if (control.kind === 'text') {
        stringValue = String(rawValue ?? '');
      } else if (control.kind === 'file') {
        fileDisplayValue = getDisplayFileValue(control);
      } else if (control.kind === 'action') {
        actionLabel = control.buttonLabelKey
          ? t(control.buttonLabelKey)
          : (control.buttonLabel ?? label);
      } else if (control.kind === 'array') {
        arrayItems = getArrayItems(control);
      }

      return {
        control,
        key: control.key ?? `${control.kind}-${label}`,
        kind: control.kind,
        label,
        disabled: Boolean(control.disabled || props.disabled),
        value: rawValue,
        numberValue,
        stringValue,
        selectItems,
        fileDisplayValue,
        actionLabel,
        arrayItems,
        scaleXYState,
        hasValue: rawValue !== undefined && rawValue !== null && rawValue !== '',
      };
    });
});

function handleAction(action: string | undefined, key: string | undefined) {
  if (!action || !key) return;
  emit('action', action, key);
}

function showStopwatch(key: string, kind: string): boolean {
  return !!props.keyframes && props.keyframes.isKeyframable(key, kind);
}

function handleScaleReset(control: RenderableParamControl) {
  updateValue(control.keyX, control.defaultValueX ?? 100);
  scheduleValueUpdate(control.keyY, control.defaultValueY ?? 100);
}

function handleScaleXUpdate(
  control: RenderableParamControl,
  state: ReturnType<typeof buildScaleXYState>,
  value: number,
) {
  const numValue = Number(value);
  updateValue(control.keyX, numValue);
  if (state.isLinked) {
    scheduleValueUpdate(control.keyY, numValue);
  }
}

function handleScaleYUpdate(
  control: RenderableParamControl,
  state: ReturnType<typeof buildScaleXYState>,
  value: number,
) {
  const numValue = Number(value);
  updateValue(control.keyY, numValue);
  if (state.isLinked) {
    scheduleValueUpdate(control.keyX, numValue);
  }
}

function toggleScaleLink(
  control: RenderableParamControl,
  state: ReturnType<typeof buildScaleXYState>,
) {
  const isLinked = !state.isLinked;
  updateValue(control.keyLinked, isLinked);
  if (isLinked) {
    scheduleValueUpdate(control.keyY, state.xValue);
  }
}

function clearFileValue(control: RenderableParamControl) {
  updateValue(control.key, undefined);
  if (control.kindKey) updateValue(control.kindKey, undefined);
}

function getArrayValue(control: RenderableParamControl): unknown[] {
  const value = getValue(control.key);
  return Array.isArray(value) ? [...value] : [];
}

function handleArrayAdd(control: RenderableParamControl) {
  const current = getArrayValue(control);
  current.push({ ...(control.defaultItem ?? {}) });
  updateValue(control.key, current);
}

function handleArrayRemove(control: RenderableParamControl, index: number) {
  const current = getArrayValue(control);
  current.splice(index, 1);
  updateValue(control.key, current);
}

function handleArrayItemUpdate(
  control: RenderableParamControl,
  index: number,
  itemKey: string,
  value: unknown,
) {
  const current = getArrayValue(control);
  if (current[index]) {
    current[index] = { ...(current[index] as Record<string, unknown>), [itemKey]: value };
    updateValue(control.key, current);
  }
}
</script>

<template>
  <div :class="props.asContents ? 'contents' : 'flex flex-col gap-2'">
    <template v-for="entry in visibleControlEntries" :key="entry.key">
      <div
        v-if="entry.kind === 'row'"
        class="grid gap-2"
        :class="entry.control.columns === 1 ? 'grid-cols-1' : 'grid-cols-2'"
        :data-testid="props.testIdPrefix ? `${props.testIdPrefix}-param-${entry.key}` : undefined"
        :data-param-key="entry.key"
      >
        <ParamsRenderer
          :controls="entry.control.controls ?? []"
          :values="values"
          :size="size"
          as-contents
          :force-full-width="Boolean(entry.control.columns && entry.control.columns > 1)"
          :test-id-prefix="props.testIdPrefix"
          :keyframes="props.keyframes"
          @update:value="(key, value) => updateValue(key, value)"
        />
      </div>

      <div v-else-if="entry.kind === 'slider'" class="flex items-center gap-1">
        <ClipAnimationStopwatchButton
          v-if="showStopwatch(entry.key, entry.kind)"
          :active="props.keyframes!.isAnimated(entry.key)"
          :disabled="entry.disabled"
          @toggle="props.keyframes!.toggle(entry.key)"
        />
        <UiSliderInput
          class="flex-1 min-w-0"
          :model-value="entry.numberValue"
          :label="entry.label"
          :formatted-value="
            entry.control.format
              ? entry.control.format(entry.numberValue)
              : String(entry.numberValue)
          "
          :min="entry.control.min ?? 0"
          :max="entry.control.max ?? 100"
          :input-min="props.numericInputRanges?.[entry.key]?.min"
          :input-max="props.numericInputRanges?.[entry.key]?.max"
          :step="entry.control.step ?? 1"
          :default-value="entry.control.defaultValue"
          :disabled="entry.disabled"
          :data-testid="props.testIdPrefix ? `${props.testIdPrefix}-param-${entry.key}` : undefined"
          :data-param-key="entry.key"
          show-input
          @update:model-value="(value: number) => updateValue(entry.control.key, value)"
        />
      </div>

      <div
        v-else-if="entry.kind === 'knob'"
        class="flex flex-col items-center justify-center gap-1.5 py-1"
        :data-testid="props.testIdPrefix ? `${props.testIdPrefix}-param-${entry.key}` : undefined"
        :data-param-key="entry.key"
      >
        <UiKnob
          :model-value="entry.numberValue"
          :min="entry.control.min ?? 0"
          :max="entry.control.max ?? 100"
          :step="entry.control.step ?? 1"
          :default-value="entry.control.defaultValue"
          :disabled="entry.disabled"
          size="md"
          @update:model-value="(value: number) => updateValue(entry.control.key, value)"
        />
        <div class="flex flex-col items-center text-2xs leading-tight">
          <span class="text-ui-text-muted text-center">{{ entry.label }}</span>
          <span class="font-mono text-ui-text">
            {{ entry.control.format ? entry.control.format(entry.numberValue) : entry.numberValue }}
          </span>
        </div>
      </div>

      <div v-else-if="entry.kind === 'number'" class="flex flex-col gap-0.5">
        <div class="flex items-center gap-1">
          <ClipAnimationStopwatchButton
            v-if="showStopwatch(entry.key, entry.kind)"
            :active="props.keyframes!.isAnimated(entry.key)"
            :disabled="entry.disabled"
            @toggle="props.keyframes!.toggle(entry.key)"
          />
          <span
            class="text-xs text-ui-text-muted"
            :data-testid="
              props.testIdPrefix ? `${props.testIdPrefix}-param-${entry.key}` : undefined
            "
            :data-param-key="entry.key"
          >
            {{ entry.label }}
          </span>
        </div>
        <UiWheelNumberInput
          :model-value="entry.numberValue"
          :size="size"
          :min="
            entry.control.min !== undefined
              ? entry.control.displayMultiplier
                ? entry.control.min * entry.control.displayMultiplier
                : entry.control.min
              : undefined
          "
          :max="
            entry.control.max !== undefined
              ? entry.control.displayMultiplier
                ? entry.control.max * entry.control.displayMultiplier
                : entry.control.max
              : undefined
          "
          :step="
            entry.control.step !== undefined
              ? entry.control.displayMultiplier
                ? entry.control.step * entry.control.displayMultiplier
                : entry.control.step
              : 1
          "
          :disabled="entry.disabled"
          :full-width="props.forceFullWidth"
          @update:model-value="
            (value: number) =>
              updateValue(
                entry.control.key,
                entry.control.displayMultiplier
                  ? Number(value) / entry.control.displayMultiplier
                  : Number(value),
              )
          "
        >
          <template v-if="entry.control.suffix" #trailing>
            <span class="text-xs text-ui-text-muted pr-1.5 select-none">{{
              entry.control.suffix
            }}</span>
          </template>
        </UiWheelNumberInput>
      </div>

      <div v-else-if="entry.kind === 'scale-xy' && entry.scaleXYState" class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <span
            class="flex-1 text-xs text-ui-text-muted"
            :class="[entry.scaleXYState.isLinked ? 'cursor-pointer' : 'cursor-default']"
          >
            {{ entry.scaleXYState.label }}
          </span>
          <UButton
            v-if="entry.scaleXYState.canReset"
            icon="i-heroicons-arrow-path"
            size="2xs"
            variant="ghost"
            color="gray"
            class="opacity-50 hover:opacity-100 transition-opacity"
            @click="handleScaleReset(entry.control)"
          />
        </div>
        <div class="flex items-center gap-2">
          <UiWheelNumberInput
            class="flex-1"
            :model-value="entry.scaleXYState.xValue"
            :size="size"
            :min="entry.control.min"
            :max="entry.control.max"
            :step="entry.control.step ?? 1"
            :disabled="entry.disabled"
            full-width
            @update:model-value="
              (value: number) => handleScaleXUpdate(entry.control, entry.scaleXYState!, value)
            "
          />
          <UButton
            size="xs"
            variant="ghost"
            color="gray"
            :icon="entry.scaleXYState.isLinked ? 'i-heroicons-link' : 'i-heroicons-link-slash'"
            :class="[entry.scaleXYState.isLinked ? 'text-ui-primary' : 'text-ui-text-muted']"
            @click="toggleScaleLink(entry.control, entry.scaleXYState)"
          />
        </div>
        <div v-if="!entry.scaleXYState.isLinked" class="flex flex-col gap-0.5 mt-2">
          <span class="text-xs text-ui-text-muted">{{ entry.scaleXYState.yLabel }}</span>
          <UiWheelNumberInput
            :model-value="entry.scaleXYState.yValue"
            :size="size"
            :min="entry.control.min"
            :max="entry.control.max"
            :step="entry.control.step ?? 1"
            :disabled="entry.disabled"
            full-width
            @update:model-value="
              (value: number) => handleScaleYUpdate(entry.control, entry.scaleXYState!, value)
            "
          />
        </div>
      </div>

      <div
        v-else-if="entry.kind === 'toggle' || entry.kind === 'boolean'"
        class="flex items-center justify-between gap-3"
        :data-testid="props.testIdPrefix ? `${props.testIdPrefix}-param-${entry.key}` : undefined"
        :data-param-key="entry.key"
      >
        <div class="flex items-center gap-1">
          <ClipAnimationStopwatchButton
            v-if="showStopwatch(entry.key, entry.kind)"
            :active="props.keyframes!.isAnimated(entry.key)"
            :disabled="entry.disabled"
            @toggle="props.keyframes!.toggle(entry.key)"
          />
          <span class="text-xs text-ui-text-muted">{{ entry.label }}</span>
        </div>
        <USwitch
          :model-value="Boolean(entry.value)"
          size="sm"
          :disabled="entry.disabled"
          @update:model-value="(value: boolean) => updateValue(entry.control.key, value)"
        />
      </div>

      <div v-else-if="entry.kind === 'select'" class="flex flex-col gap-0.5">
        <span
          class="text-xs text-ui-text-muted"
          :data-testid="props.testIdPrefix ? `${props.testIdPrefix}-param-${entry.key}` : undefined"
          :data-param-key="entry.key"
        >
          {{ entry.label }}
        </span>
        <UiSelect
          :model-value="entry.value as string"
          :items="entry.selectItems"
          value-key="value"
          label-key="label"
          :size="size"
          :disabled="entry.disabled"
          @update:model-value="
            (value: unknown) => updateValue(entry.control.key, normalizeSelectValue(value))
          "
        />
      </div>

      <div v-else-if="entry.kind === 'button-group'" class="flex flex-col gap-1">
        <span
          class="text-xs text-ui-text-muted"
          :data-testid="props.testIdPrefix ? `${props.testIdPrefix}-param-${entry.key}` : undefined"
          :data-param-key="entry.key"
        >
          {{ entry.label }}
        </span>
        <UiButtonGroup
          :model-value="entry.value"
          :options="entry.selectItems"
          size="xs"
          :disabled="entry.disabled"
          fluid
          @update:model-value="
            (value: unknown) => updateValue(entry.control.key, normalizeSelectValue(value))
          "
        />
      </div>

      <div v-else-if="entry.kind === 'color'" class="flex flex-col gap-0.5">
        <span
          class="text-xs text-ui-text-muted"
          :data-testid="props.testIdPrefix ? `${props.testIdPrefix}-param-${entry.key}` : undefined"
          :data-param-key="entry.key"
        >
          {{ entry.label }}
        </span>
        <UiColorBlendPicker
          :color="entry.stringValue"
          :disabled="entry.disabled"
          :show-alpha="false"
          :show-blend-mode="false"
          @update:color="(value: string) => updateValue(entry.control.key, value)"
        />
      </div>

      <div v-else-if="entry.kind === 'text'" class="flex flex-col gap-0.5">
        <span
          class="text-xs text-ui-text-muted"
          :data-testid="props.testIdPrefix ? `${props.testIdPrefix}-param-${entry.key}` : undefined"
          :data-param-key="entry.key"
        >
          {{ entry.label }}
        </span>
        <UiTextarea
          v-if="entry.control.multiline"
          :model-value="entry.stringValue"
          :rows="entry.control.rows ?? 4"
          :placeholder="entry.control.placeholder"
          :size="size"
          :disabled="entry.disabled"
          @update:model-value="
            (value: string) => updateValue(entry.control.key, String(value ?? ''))
          "
        />
        <UiTextInput
          v-else
          :model-value="entry.stringValue"
          :placeholder="entry.control.placeholder"
          :size="size"
          :disabled="entry.disabled"
          full-width
          @update:model-value="
            (value: string) => updateValue(entry.control.key, String(value ?? ''))
          "
        />
      </div>

      <div v-else-if="entry.kind === 'file'" class="flex flex-col gap-1">
        <span
          class="text-xs text-ui-text-muted"
          :data-testid="props.testIdPrefix ? `${props.testIdPrefix}-param-${entry.key}` : undefined"
          :data-param-key="entry.key"
        >
          {{ entry.label }}
        </span>
        <div
          class="flex items-center gap-2 p-2 rounded border border-dashed transition-colors"
          :class="
            dragOverKey === entry.control.key
              ? 'border-primary-500 bg-primary-500/10'
              : 'border-ui-border bg-ui-bg-muted'
          "
          @dragover.prevent.stop="dragOverKey = entry.control.key ?? null"
          @dragleave.prevent.stop="
            dragOverKey = dragOverKey === entry.control.key ? null : dragOverKey
          "
          @drop.prevent.stop="handleFileDrop($event, entry.control)"
        >
          <div class="flex-1 min-w-0 flex items-center gap-2">
            <UIcon
              :name="entry.control.icon ?? 'i-heroicons-document'"
              class="w-4 h-4 text-ui-text-muted shrink-0"
            />
            <span class="text-xs text-ui-text truncate">{{ entry.fileDisplayValue }}</span>
          </div>
          <UButton
            v-if="entry.hasValue && !entry.control.disabled"
            icon="i-heroicons-x-mark"
            size="2xs"
            color="gray"
            variant="ghost"
            @click="clearFileValue(entry.control)"
          />
        </div>
      </div>

      <div v-else-if="entry.kind === 'action'" class="flex flex-col gap-1">
        <UButton
          :icon="entry.control.icon"
          :disabled="entry.disabled"
          :size="size"
          color="white"
          variant="solid"
          class="justify-center w-full"
          @click="handleAction(entry.control.action, entry.control.key)"
        >
          {{ entry.actionLabel }}
        </UButton>
      </div>

      <div v-else-if="entry.kind === 'array'" class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-ui-text-muted">{{ entry.label }}</span>
          <UButton
            icon="i-heroicons-plus"
            size="2xs"
            color="primary"
            variant="soft"
            :disabled="entry.disabled"
            @click="handleArrayAdd(entry.control)"
          >
            {{
              entry.control.addLabelKey
                ? t(entry.control.addLabelKey)
                : (entry.control.addLabel ?? 'Add')
            }}
          </UButton>
        </div>

        <UiEmptyState
          v-if="entry.arrayItems.length === 0"
          :message="
            entry.control.emptyLabelKey
              ? t(entry.control.emptyLabelKey)
              : (entry.control.emptyLabel ?? 'Empty')
          "
          wrapper-class="py-2 border border-dashed border-ui-border rounded not-italic"
        />

        <div
          v-else
          :class="[
            'flex gap-2',
            entry.control.layout === 'horizontal'
              ? 'flex-row overflow-x-auto pb-2 snap-x snap-mandatory'
              : 'flex-col',
          ]"
        >
          <div
            v-for="(item, index) in entry.arrayItems"
            :key="index"
            class="flex flex-col gap-2 bg-ui-bg-elevated border border-ui-border rounded relative group shrink-0"
            :class="entry.control.layout === 'horizontal' ? 'w-32 snap-center' : 'p-3'"
          >
            <div
              class="flex items-center justify-between border-b border-ui-border/50 bg-ui-bg-muted/50 rounded-t"
              :class="
                entry.control.layout === 'horizontal' ? 'p-1.5' : 'pb-2 mb-1 -mx-3 -mt-3 px-3 pt-2'
              "
            >
              <span class="text-2xs font-medium text-ui-text-muted tracking-wider">
                #{{ Number(index) + 1 }}
              </span>
              <UButton
                icon="i-heroicons-trash"
                size="2xs"
                color="red"
                variant="ghost"
                :disabled="entry.disabled"
                class="opacity-0 group-hover:opacity-100 transition-opacity"
                @click="handleArrayRemove(entry.control, Number(index))"
              />
            </div>
            <div
              :class="['flex flex-col gap-2', entry.control.layout === 'horizontal' ? 'p-2' : '']"
            >
              <ParamsRenderer
                :controls="entry.control.itemTemplate ?? []"
                :values="item"
                :size="size"
                as-contents
                @update:value="
                  (key, value) => handleArrayItemUpdate(entry.control, Number(index), key, value)
                "
              />
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
