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

function getVerticalPadding() {
  const padding = props.clip.style?.padding;
  if (typeof padding === 'number' && Number.isFinite(padding)) return padding;
  if (padding && typeof padding === 'object') {
    if ('top' in padding) return padding.top ?? 60;
    if ('y' in padding || 'x' in padding) return ('y' in padding ? padding.y : padding.x) ?? 60;
  }
  return 60;
}

const blendModeOptions = computed<Array<{ value: TimelineBlendMode; label: string }>>(() =>
  RAW_BLEND_MODE_OPTIONS.map((opt) => ({
    value: opt.value as TimelineBlendMode,
    label: t(opt.labelKey),
  })),
);
</script>

<template>
  <PropertySection :title="t('fastcat.textClip.text')">
    <div class="flex flex-col gap-2">
      <div v-if="!hidePresets" class="flex flex-col gap-1 pb-2 border-b border-ui-border mb-1">
        <div class="flex items-center justify-between">
          <div
            class="text-[10px] font-medium uppercase tracking-wider text-ui-text-muted opacity-70"
          >
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
        <div class="flex gap-2">
          <UiSelect
            :items="props.presets"
            :placeholder="t('fastcat.effects.loadPresetPlaceholder')"
            class="flex-1"
            size="xs"
            full-width
            @update:model-value="
              (v: unknown) => emit('loadPreset', (v as { value: string })?.value ?? v)
            "
          />
        </div>
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
          :items="[
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
          ]"
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
            :items="
              ['100', '200', '300', '400', '500', '600', '700', '800', '900'].map((w) => ({
                value: w,
                label: w,
              }))
            "
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

      <div class="flex items-center justify-between gap-3">
        <span class="text-xs text-ui-text-muted">{{
          t('fastcat.textClip.backgroundEnabled')
        }}</span>
        <USwitch
          :model-value="Boolean(clip.style?.backgroundEnabled ?? clip.style?.backgroundColor)"
          size="sm"
          @update:model-value="(v: boolean) => emit('updateTextStyle', { backgroundEnabled: v })"
        />
      </div>

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
        <PropertyField :label="t('fastcat.textClip.verticalPadding')">
          <UiWheelNumberInput
            :model-value="getVerticalPadding()"
            size="sm"
            :step="1"
            :min="0"
            full-width
            @update:model-value="(v: any) => emit('updateTextStyle', { padding: Number(v) })"
          />
        </PropertyField>
      </div>

      <PropertyField :label="t('fastcat.textClip.align')">
        <UiSelect
          :model-value="String(clip.style?.align ?? 'center')"
          :items="[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]"
          value-key="value"
          label-key="label"
          size="sm"
          @update:model-value="(v: unknown) => emit('updateTextStyle', { align: v })"
        />
      </PropertyField>

      <PropertyField :label="t('fastcat.textClip.verticalAlign')">
        <UiSelect
          :model-value="String(clip.style?.verticalAlign ?? 'middle')"
          :items="[
            { value: 'top', label: 'Top' },
            { value: 'middle', label: 'Middle' },
            { value: 'bottom', label: 'Bottom' },
          ]"
          value-key="value"
          label-key="label"
          size="sm"
          @update:model-value="(v: unknown) => emit('updateTextStyle', { verticalAlign: v })"
        />
      </PropertyField>

      <div class="grid grid-cols-2 gap-2">
        <PropertyField :label="t('fastcat.textClip.lineHeight')">
          <UiWheelNumberInput
            :model-value="Number(clip.style?.lineHeight ?? 1.2)"
            size="sm"
            :step="0.1"
            full-width
            @update:model-value="(v: any) => emit('updateTextStyle', { lineHeight: Number(v) })"
          />
        </PropertyField>
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

      <div class="grid grid-cols-2 gap-2">
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
        <PropertyField :label="t('fastcat.textClip.borderWidth')">
          <UiWheelNumberInput
            :model-value="Number(clip.style?.borderWidth ?? 0)"
            size="sm"
            :step="1"
            :min="0"
            full-width
            @update:model-value="(v: any) => emit('updateTextStyle', { borderWidth: Number(v) })"
          />
        </PropertyField>
      </div>

      <div class="flex items-center justify-between gap-3">
        <span class="text-xs text-ui-text-muted">{{ t('fastcat.textClip.borderEnabled') }}</span>
        <USwitch
          :model-value="Boolean(clip.style?.borderEnabled)"
          size="sm"
          @update:model-value="(v: boolean) => emit('updateTextStyle', { borderEnabled: v })"
        />
      </div>

      <PropertyField :label="t('fastcat.textClip.borderColor')">
        <UiColorBlendPicker
          :color="String(clip.style?.borderColor ?? '#ffffff')"
          :alpha="Number(clip.style?.borderAlpha ?? 1)"
          :show-blend-mode="false"
          @update:color="(v: string) => emit('updateTextStyle', { borderColor: v })"
          @update:alpha="(v: number) => emit('updateTextStyle', { borderAlpha: v })"
        />
      </PropertyField>
    </div>
  </PropertySection>
</template>
