<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineTextClipItem, TimelineBlendMode } from '~/timeline/types';
import { BLEND_MODE_OPTIONS as RAW_BLEND_MODE_OPTIONS } from '~/utils/constants';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyField from '~/components/properties/PropertyField.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiTextarea from '~/components/ui/UiTextarea.vue';
import UiColorBlendPicker from '~/components/ui/UiColorBlendPicker.vue';

const props = defineProps<{
  clip: TimelineTextClipItem;
  presets: Array<{ label: string; value: string }>;
  hidePresets?: boolean;
}>();

const emit = defineEmits<{
  (e: 'updateText' | 'loadPreset', val: string): void;
  (e: 'updateTextStyle', patch: Record<string, unknown>): void;
  (e: 'savePreset'): void;
}>();

const { t } = useI18n();

function getPaddingAxis(axis: 'x' | 'y') {
  const padding = props.clip.style?.padding;
  if (typeof padding === 'number' && Number.isFinite(padding)) return padding;
  if (padding && typeof padding === 'object') {
    if (axis === 'x') {
      if ('left' in padding || 'right' in padding) return padding.left ?? padding.right ?? 60;
      if ('x' in padding || 'y' in padding) return padding.x ?? padding.y ?? 60;
    }
    if ('top' in padding || 'bottom' in padding) return padding.top ?? padding.bottom ?? 60;
    if ('y' in padding || 'x' in padding) return padding.y ?? padding.x ?? 60;
  }
  return 60;
}

function updatePaddingAxis(axis: 'x' | 'y', value: number) {
  const safe = Math.max(0, Number(value));
  const currentX = getPaddingAxis('x');
  const currentY = getPaddingAxis('y');
  emit('updateTextStyle', {
    padding: {
      top: axis === 'y' ? safe : currentY,
      right: axis === 'x' ? safe : currentX,
      bottom: axis === 'y' ? safe : currentY,
      left: axis === 'x' ? safe : currentX,
    },
  });
}

const blendModeOptions = computed<Array<{ value: TimelineBlendMode; label: string }>>(() =>
  RAW_BLEND_MODE_OPTIONS.map((opt) => ({
    value: opt.value as TimelineBlendMode,
    label: t(opt.labelKey),
  })),
);

const backgroundEnabled = computed({
  get: () => Boolean(props.clip.style?.backgroundEnabled ?? props.clip.style?.backgroundColor),
  set: (value: boolean) => emit('updateTextStyle', { backgroundEnabled: value }),
});

const borderEnabled = computed({
  get: () => Boolean(props.clip.style?.borderEnabled),
  set: (value: boolean) => emit('updateTextStyle', { borderEnabled: value }),
});

const textShadowEnabled = computed({
  get: () => Boolean(props.clip.style?.textShadowEnabled),
  set: (value: boolean) => emit('updateTextStyle', { textShadowEnabled: value }),
});

const backgroundShadowEnabled = computed({
  get: () => Boolean(props.clip.style?.backgroundShadowEnabled),
  set: (value: boolean) => emit('updateTextStyle', { backgroundShadowEnabled: value }),
});

const isAutoHeight = computed({
  get: () => !(typeof props.clip.style?.height === 'number' && props.clip.style.height > 0),
  set: (value: boolean) => {
    emit('updateTextStyle', {
      height: value ? undefined : Number(props.clip.style?.height ?? 240),
    });
  },
});

const alignOptions = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

const verticalAlignOptions = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
];

const fontFamilyOptions = [
  { value: 'sans-serif', label: 'Sans Serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Arial Black', label: 'Arial Black' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Tahoma', label: 'Tahoma' },
  { value: 'Trebuchet MS', label: 'Trebuchet MS' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Impact', label: 'Impact' },
];

const fontWeightOptions = ['100', '200', '300', '400', '500', '600', '700', '800', '900'].map(
  (weight) => ({
    value: weight,
    label: weight,
  }),
);
</script>

<template>
  <div class="flex flex-col gap-2">
    <PropertySection :title="t('fastcat.textClip.textBlock')">
      <div class="flex flex-col gap-2">
        <div v-if="!hidePresets" class="flex flex-col gap-1 pb-2 border-b border-ui-border mb-1">
          <div class="flex items-center justify-between">
            <div class="text-[10px] font-medium uppercase tracking-wider text-ui-text-muted/70">
              {{ t('fastcat.effects.presetsTitle') }}
            </div>
            <UButton
              icon="i-heroicons-bookmark"
              variant="ghost"
              size="2xs"
              color="white"
              @click="emit('savePreset')"
            >
              {{ t('fastcat.presets.saveAsPreset') }}
            </UButton>
          </div>
          <UiSelect
            :items="props.presets"
            :placeholder="t('fastcat.effects.loadPresetPlaceholder')"
            size="xs"
            full-width
            @update:model-value="
              (v: unknown) => emit('loadPreset', (v as { value: string })?.value ?? v)
            "
          />
        </div>

        <UiTextarea
          :model-value="clip.text"
          size="sm"
          :rows="4"
          @update:model-value="emit('updateText', String($event))"
        />

        <PropertyField :label="t('fastcat.textClip.fontFamily')">
          <UiSelect
            :model-value="String(clip.style?.fontFamily ?? 'sans-serif')"
            :items="fontFamilyOptions"
            value-key="value"
            label-key="label"
            size="sm"
            @update:model-value="
              (v: unknown) =>
                emit('updateTextStyle', { fontFamily: (v as { value: string })?.value ?? v })
            "
          />
        </PropertyField>

        <div class="grid grid-cols-2 gap-2">
          <PropertyField :label="t('fastcat.textClip.fontSize')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.fontSize ?? 64)"
              size="sm"
              :step="1"
              :min="1"
              full-width
              @update:model-value="(v: any) => emit('updateTextStyle', { fontSize: Number(v) })"
            />
          </PropertyField>
          <PropertyField :label="t('fastcat.textClip.fontWeight')">
            <UiSelect
              :model-value="String(clip.style?.fontWeight ?? '700')"
              :items="fontWeightOptions"
              value-key="value"
              label-key="label"
              size="sm"
              @update:model-value="
                (v: unknown) =>
                  emit('updateTextStyle', { fontWeight: (v as { value: string })?.value ?? v })
              "
            />
          </PropertyField>
        </div>

        <PropertyField :label="t('common.color')">
          <UiColorBlendPicker
            :color="String(clip.style?.color ?? '#ffffff')"
            :alpha="Number(clip.style?.colorAlpha ?? 1)"
            :blend-mode="(clip.style?.colorBlendMode as TimelineBlendMode) ?? 'normal'"
            :blend-mode-options="blendModeOptions"
            @update:color="(v: string) => emit('updateTextStyle', { color: v })"
            @update:alpha="(v: number) => emit('updateTextStyle', { colorAlpha: v })"
            @update:blend-mode="
              (v: TimelineBlendMode) => emit('updateTextStyle', { colorBlendMode: v })
            "
          />
        </PropertyField>

        <div class="grid grid-cols-2 gap-2">
          <PropertyField :label="t('fastcat.textClip.align')">
            <UiSelect
              :model-value="String(clip.style?.align ?? 'center')"
              :items="alignOptions"
              value-key="value"
              label-key="label"
              size="sm"
              @update:model-value="(v: unknown) => emit('updateTextStyle', { align: v })"
            />
          </PropertyField>
          <PropertyField :label="t('fastcat.textClip.lineHeight')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.lineHeight ?? 1.2)"
              size="sm"
              :step="0.1"
              full-width
              @update:model-value="(v: any) => emit('updateTextStyle', { lineHeight: Number(v) })"
            />
          </PropertyField>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <PropertyField :label="t('fastcat.textClip.width')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.width ?? 0)"
              size="sm"
              :step="10"
              :min="0"
              full-width
              @update:model-value="
                (v: any) => emit('updateTextStyle', { width: v > 0 ? Number(v) : undefined })
              "
            />
          </PropertyField>
          <PropertyField :label="t('fastcat.textClip.heightMode')">
            <div class="h-8 flex items-center justify-between gap-2">
              <span class="text-xs text-ui-text-muted">{{ t('fastcat.textClip.autoHeight') }}</span>
              <USwitch v-model="isAutoHeight" size="sm" color="error" />
            </div>
          </PropertyField>
        </div>

        <div v-if="!isAutoHeight" class="grid grid-cols-2 gap-2">
          <PropertyField :label="t('fastcat.textClip.height')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.height ?? 240)"
              size="sm"
              :step="10"
              :min="1"
              full-width
              @update:model-value="(v: any) => emit('updateTextStyle', { height: Number(v) })"
            />
          </PropertyField>
          <PropertyField :label="t('fastcat.textClip.verticalAlign')">
            <UiSelect
              :model-value="String(clip.style?.verticalAlign ?? 'middle')"
              :items="verticalAlignOptions"
              value-key="value"
              label-key="label"
              size="sm"
              @update:model-value="(v: unknown) => emit('updateTextStyle', { verticalAlign: v })"
            />
          </PropertyField>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <PropertyField :label="t('fastcat.textClip.horizontalPadding')">
            <UiWheelNumberInput
              :model-value="getPaddingAxis('x')"
              size="sm"
              :step="1"
              :min="0"
              full-width
              @update:model-value="(v: any) => updatePaddingAxis('x', Number(v))"
            />
          </PropertyField>
          <PropertyField :label="t('fastcat.textClip.verticalPadding')">
            <UiWheelNumberInput
              :model-value="getPaddingAxis('y')"
              size="sm"
              :step="1"
              :min="0"
              full-width
              @update:model-value="(v: any) => updatePaddingAxis('y', Number(v))"
            />
          </PropertyField>
        </div>

        <PropertyField :label="t('fastcat.textClip.letterSpacing')">
          <UiWheelNumberInput
            :model-value="Number(clip.style?.letterSpacing ?? 0)"
            size="sm"
            :step="1"
            full-width
            @update:model-value="(v: any) => emit('updateTextStyle', { letterSpacing: Number(v) })"
          />
        </PropertyField>
      </div>
    </PropertySection>

    <PropertySection
      v-model:toggle-value="textShadowEnabled"
      :title="t('fastcat.textClip.textShadow')"
      has-toggle
    >
      <div v-if="textShadowEnabled" class="flex flex-col gap-2">
        <PropertyField :label="t('common.color')">
          <UiColorBlendPicker
            :color="String(clip.style?.textShadowColor ?? '#000000')"
            :alpha="Number(clip.style?.textShadowAlpha ?? 1)"
            :show-blend-mode="false"
            @update:color="(v: string) => emit('updateTextStyle', { textShadowColor: v })"
            @update:alpha="(v: number) => emit('updateTextStyle', { textShadowAlpha: v })"
          />
        </PropertyField>
        <div class="grid grid-cols-3 gap-2">
          <PropertyField :label="t('fastcat.textClip.shadowBlur')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.textShadowBlur ?? 8)"
              size="sm"
              :step="1"
              :min="0"
              full-width
              @update:model-value="
                (v: any) => emit('updateTextStyle', { textShadowBlur: Number(v) })
              "
            />
          </PropertyField>
          <PropertyField :label="t('fastcat.textClip.shadowOffsetX')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.textShadowOffsetX ?? 0)"
              size="sm"
              :step="1"
              full-width
              @update:model-value="
                (v: any) => emit('updateTextStyle', { textShadowOffsetX: Number(v) })
              "
            />
          </PropertyField>
          <PropertyField :label="t('fastcat.textClip.shadowOffsetY')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.textShadowOffsetY ?? 4)"
              size="sm"
              :step="1"
              full-width
              @update:model-value="
                (v: any) => emit('updateTextStyle', { textShadowOffsetY: Number(v) })
              "
            />
          </PropertyField>
        </div>
      </div>
    </PropertySection>

    <PropertySection
      v-model:toggle-value="backgroundEnabled"
      :title="t('fastcat.textClip.backgroundBlock')"
      has-toggle
    >
      <div v-if="backgroundEnabled" class="flex flex-col gap-2">
        <PropertyField :label="t('fastcat.textClip.backgroundColor')">
          <UiColorBlendPicker
            :color="String(clip.style?.backgroundColor ?? '#000000')"
            :alpha="Number(clip.style?.backgroundAlpha ?? 1)"
            :blend-mode="(clip.style?.backgroundBlendMode as TimelineBlendMode) ?? 'normal'"
            :blend-mode-options="blendModeOptions"
            @update:color="(v: string) => emit('updateTextStyle', { backgroundColor: v })"
            @update:alpha="(v: number) => emit('updateTextStyle', { backgroundAlpha: v })"
            @update:blend-mode="
              (v: TimelineBlendMode) => emit('updateTextStyle', { backgroundBlendMode: v })
            "
          />
        </PropertyField>
        <PropertyField :label="t('fastcat.textClip.backgroundRadius')">
          <UiWheelNumberInput
            :model-value="Number(clip.style?.backgroundRadius ?? 0)"
            size="sm"
            :step="1"
            :min="0"
            full-width
            @update:model-value="
              (v: any) => emit('updateTextStyle', { backgroundRadius: Number(v) })
            "
          />
        </PropertyField>
      </div>
    </PropertySection>

    <PropertySection
      v-if="backgroundEnabled"
      v-model:toggle-value="backgroundShadowEnabled"
      :title="t('fastcat.textClip.backgroundShadow')"
      has-toggle
    >
      <div v-if="backgroundShadowEnabled" class="flex flex-col gap-2">
        <PropertyField :label="t('common.color')">
          <UiColorBlendPicker
            :color="String(clip.style?.backgroundShadowColor ?? '#000000')"
            :alpha="Number(clip.style?.backgroundShadowAlpha ?? 1)"
            :show-blend-mode="false"
            @update:color="(v: string) => emit('updateTextStyle', { backgroundShadowColor: v })"
            @update:alpha="(v: number) => emit('updateTextStyle', { backgroundShadowAlpha: v })"
          />
        </PropertyField>
        <div class="grid grid-cols-3 gap-2">
          <PropertyField :label="t('fastcat.textClip.shadowBlur')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.backgroundShadowBlur ?? 12)"
              size="sm"
              :step="1"
              :min="0"
              full-width
              @update:model-value="
                (v: any) => emit('updateTextStyle', { backgroundShadowBlur: Number(v) })
              "
            />
          </PropertyField>
          <PropertyField :label="t('fastcat.textClip.shadowOffsetX')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.backgroundShadowOffsetX ?? 0)"
              size="sm"
              :step="1"
              full-width
              @update:model-value="
                (v: any) => emit('updateTextStyle', { backgroundShadowOffsetX: Number(v) })
              "
            />
          </PropertyField>
          <PropertyField :label="t('fastcat.textClip.shadowOffsetY')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.backgroundShadowOffsetY ?? 6)"
              size="sm"
              :step="1"
              full-width
              @update:model-value="
                (v: any) => emit('updateTextStyle', { backgroundShadowOffsetY: Number(v) })
              "
            />
          </PropertyField>
        </div>
      </div>
    </PropertySection>

    <PropertySection
      v-model:toggle-value="borderEnabled"
      :title="t('fastcat.textClip.borderBlock')"
      has-toggle
    >
      <div v-if="borderEnabled" class="flex flex-col gap-2">
        <PropertyField :label="t('fastcat.textClip.borderColor')">
          <UiColorBlendPicker
            :color="String(clip.style?.borderColor ?? '#ffffff')"
            :alpha="Number(clip.style?.borderAlpha ?? 1)"
            :show-blend-mode="false"
            @update:color="(v: string) => emit('updateTextStyle', { borderColor: v })"
            @update:alpha="(v: number) => emit('updateTextStyle', { borderAlpha: v })"
          />
        </PropertyField>
        <PropertyField :label="t('fastcat.textClip.borderWidth')">
          <UiWheelNumberInput
            :model-value="Number(clip.style?.borderWidth ?? 2)"
            size="sm"
            :step="1"
            :min="0"
            full-width
            @update:model-value="(v: any) => emit('updateTextStyle', { borderWidth: Number(v) })"
          />
        </PropertyField>
      </div>
    </PropertySection>
  </div>
</template>
