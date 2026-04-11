<script setup lang="ts">
import { computed, ref } from 'vue';
import UiButtonGroup from '~/components/ui/UiButtonGroup.vue';
import UiWheelSlider from '~/components/ui/UiWheelSlider.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiKnob from '~/components/ui/editor/UiKnob.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import type {
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

  return t('fastcat.hudClip.emptyLayer');
}

function handleFileDrop(event: DragEvent, control: FileParamControl) {
  dragOverKey.value = null;
  const raw = event.dataTransfer?.getData('application/json');
  if (!raw) {
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
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

interface VisibleControlEntry {
  actionLabel: string;
  arrayItems: Record<string, unknown>[];
  control: ParamControl;
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
        numberValue = Number(rawValue ?? control.defaultValue ?? 0);
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
        arrayItems = Array.isArray(rawValue) ? (rawValue as Record<string, unknown>[]) : [];
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

function getMemoKey(entry: VisibleControlEntry): unknown[] {
  const base = [entry.key, entry.disabled];

  switch (entry.kind) {
    case 'slider':
    case 'knob':
    case 'number':
      return [...base, entry.numberValue];
    case 'scale-xy':
      return [
        ...base,
        entry.scaleXYState?.xValue,
        entry.scaleXYState?.yValue,
        entry.scaleXYState?.isLinked,
      ];
    case 'select':
    case 'button-group':
    case 'toggle':
    case 'boolean':
      return [...base, entry.value];
    case 'color':
    case 'text':
      return [...base, entry.stringValue];
    case 'file':
      return [...base, entry.fileDisplayValue, entry.hasValue];
    case 'action':
      return [...base, entry.actionLabel];
    case 'array':
      return [...base, JSON.stringify(entry.arrayItems)];
    case 'row':
    default:
      return base;
  }
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
    <template v-for="entry in visibleControlEntries" :key="entry.key">
      <div
        v-if="entry.kind === 'row'"
        v-memo="getMemoKey(entry)"
        class="grid gap-2"
        :class="entry.control.columns === 1 ? 'grid-cols-1' : 'grid-cols-2'"
      >
        <ParamsRenderer
          :controls="entry.control.controls"
          :values="values"
          :size="size"
          as-contents
          :force-full-width="Boolean(entry.control.columns && entry.control.columns > 1)"
          @update:value="(key, value) => updateValue(key, value)"
        />
      </div>

      <div
        v-else-if="entry.kind === 'slider'"
        v-memo="getMemoKey(entry)"
        class="flex flex-col gap-1"
      >
        <div class="flex justify-between text-xs text-ui-text-muted gap-2">
          <span>{{ entry.label }}</span>
          <span>
            {{ entry.control.format ? entry.control.format(entry.numberValue) : entry.numberValue }}
          </span>
        </div>
        <UiWheelSlider
          :model-value="entry.numberValue"
          :min="entry.control.min"
          :max="entry.control.max"
          :step="entry.control.step"
          :default-value="entry.control.defaultValue"
          :disabled="entry.disabled"
          @update:model-value="(value: number) => updateValue(entry.control.key, value)"
        />
      </div>

      <div
        v-else-if="entry.kind === 'knob'"
        v-memo="getMemoKey(entry)"
        class="flex flex-col items-center justify-center gap-1.5 py-1"
      >
        <UiKnob
          :model-value="entry.numberValue"
          :min="entry.control.min"
          :max="entry.control.max"
          :step="entry.control.step"
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

      <div
        v-else-if="entry.kind === 'number'"
        v-memo="getMemoKey(entry)"
        class="flex flex-col gap-0.5"
      >
        <span class="text-xs text-ui-text-muted">{{ entry.label }}</span>
        <UiWheelNumberInput
          :model-value="entry.numberValue"
          :size="size"
          :min="entry.control.min"
          :max="entry.control.max"
          :step="entry.control.step ?? 1"
          :disabled="entry.disabled"
          :full-width="props.forceFullWidth"
          @update:model-value="(value: number) => updateValue(entry.control.key, Number(value))"
        />
      </div>

      <div
        v-else-if="entry.kind === 'scale-xy' && entry.scaleXYState"
        v-memo="getMemoKey(entry)"
        class="flex flex-col gap-2"
      >
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
            @click="
              () => {
                updateValue(entry.control.keyX, entry.control.defaultValueX ?? 100);
                setTimeout(() => {
                  updateValue(entry.control.keyY, entry.control.defaultValueY ?? 100);
                }, 10);
              }
            "
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
              (value: number) => {
                const numValue = Number(value);
                updateValue(entry.control.keyX, numValue);
                if (entry.scaleXYState?.isLinked) {
                  setTimeout(() => {
                    updateValue(entry.control.keyY, numValue);
                  }, 10);
                }
              }
            "
          />
          <UButton
            size="xs"
            variant="ghost"
            color="gray"
            :icon="entry.scaleXYState.isLinked ? 'i-heroicons-link' : 'i-heroicons-link-slash'"
            :class="[entry.scaleXYState.isLinked ? 'text-ui-primary' : 'text-ui-text-muted']"
            @click="
              () => {
                const isLinked = !entry.scaleXYState?.isLinked;
                updateValue(entry.control.keyLinked, isLinked);
                if (isLinked) {
                  setTimeout(() => {
                    updateValue(entry.control.keyY, entry.scaleXYState?.xValue);
                  }, 10);
                }
              }
            "
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
              (value: number) => {
                const numValue = Number(value);
                updateValue(entry.control.keyY, numValue);
                if (entry.scaleXYState?.isLinked) {
                  setTimeout(() => {
                    updateValue(entry.control.keyX, numValue);
                  }, 10);
                }
              }
            "
          />
        </div>
      </div>

      <div
        v-else-if="entry.kind === 'toggle' || entry.kind === 'boolean'"
        v-memo="getMemoKey(entry)"
        class="flex items-center justify-between gap-3"
      >
        <span class="text-xs text-ui-text-muted">{{ entry.label }}</span>
        <USwitch
          :model-value="Boolean(entry.value)"
          size="sm"
          :disabled="entry.disabled"
          @update:model-value="(value: boolean) => updateValue(entry.control.key, value)"
        />
      </div>

      <div
        v-else-if="entry.kind === 'select'"
        v-memo="getMemoKey(entry)"
        class="flex flex-col gap-0.5"
      >
        <span class="text-xs text-ui-text-muted">{{ entry.label }}</span>
        <UiSelect
          :model-value="entry.value as any"
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

      <div
        v-else-if="entry.kind === 'button-group'"
        v-memo="getMemoKey(entry)"
        class="flex flex-col gap-1"
      >
        <span class="text-xs text-ui-text-muted">{{ entry.label }}</span>
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

      <div
        v-else-if="entry.kind === 'color'"
        v-memo="getMemoKey(entry)"
        class="flex flex-col gap-0.5"
      >
        <span class="text-xs text-ui-text-muted">{{ entry.label }}</span>
        <UColorPicker
          :model-value="entry.stringValue"
          format="hex"
          :size="size"
          :disabled="entry.disabled"
          @update:model-value="
            (value: unknown) => updateValue(entry.control.key, String(value ?? ''))
          "
        />
      </div>

      <div
        v-else-if="entry.kind === 'text'"
        v-memo="getMemoKey(entry)"
        class="flex flex-col gap-0.5"
      >
        <span class="text-xs text-ui-text-muted">{{ entry.label }}</span>
        <UTextarea
          v-if="entry.control.multiline"
          :model-value="entry.stringValue"
          :rows="entry.control.rows ?? 4"
          :placeholder="entry.control.placeholder"
          :size="size"
          :disabled="entry.disabled"
          @update:model-value="
            (value: string | number) => updateValue(entry.control.key, String(value ?? ''))
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

      <div v-else-if="entry.kind === 'file'" v-memo="getMemoKey(entry)" class="flex flex-col gap-1">
        <span class="text-xs text-ui-text-muted">{{ entry.label }}</span>
        <div
          class="flex items-center gap-2 p-2 rounded border border-dashed transition-colors"
          :class="
            dragOverKey === entry.control.key
              ? 'border-primary-500 bg-primary-500/10'
              : 'border-ui-border bg-ui-bg-muted'
          "
          @dragover.prevent.stop="dragOverKey = entry.control.key"
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
            @click="
              () => {
                updateValue(entry.control.key, undefined);
                if (entry.control.kindKey) updateValue(entry.control.kindKey, undefined);
              }
            "
          />
        </div>
      </div>

      <div
        v-else-if="entry.kind === 'action'"
        v-memo="getMemoKey(entry)"
        class="flex flex-col gap-1"
      >
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

      <div
        v-else-if="entry.kind === 'array'"
        v-memo="getMemoKey(entry)"
        class="flex flex-col gap-2"
      >
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

        <div
          v-if="entry.arrayItems.length === 0"
          class="text-xs text-ui-text-muted text-center py-2 border border-dashed border-ui-border rounded"
        >
          {{
            entry.control.emptyLabelKey
              ? t(entry.control.emptyLabelKey)
              : (entry.control.emptyLabel ?? 'Empty')
          }}
        </div>

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
              <span class="text-2xs font-medium text-ui-text-muted uppercase tracking-wider">
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
                :controls="entry.control.itemTemplate"
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
