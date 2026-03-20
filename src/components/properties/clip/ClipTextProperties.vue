<script setup lang="ts">
import type { TimelineTextClipItem } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyField from '~/components/properties/PropertyField.vue';
import UiWheelNumberInput from '~/components/ui/editor/UiWheelNumberInput.vue';

const props = defineProps<{
  clip: TimelineTextClipItem;
}>();

const emit = defineEmits<{
  (e: 'updateText', val: string): void;
  (e: 'updateTextStyle', patch: Record<string, unknown>): void;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection :title="t('fastcat.textClip.text', 'Text')">
    <div class="flex flex-col gap-2">
      <UTextarea
        :model-value="clip.text"
        size="sm"
        :rows="4"
        @update:model-value="emit('updateText', String($event))"
      />

      <PropertyField :label="t('fastcat.textClip.fontFamily', 'Font family')">
        <USelectMenu
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
          @update:model-value="(v: any) => emit('updateTextStyle', { fontFamily: v?.value ?? v })"
        />
      </PropertyField>

      <div class="grid grid-cols-2 gap-2">
        <PropertyField :label="t('fastcat.textClip.fontSize', 'Font size')">
          <UiWheelNumberInput
            :model-value="Number(clip.style?.fontSize ?? 64)"
            size="sm"
            :step="1"
            :min="1"
            @update:model-value="(v: any) => emit('updateTextStyle', { fontSize: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="t('fastcat.textClip.fontWeight', 'Font weight')">
          <USelectMenu
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
            @update:model-value="(v: any) => emit('updateTextStyle', { fontWeight: v?.value ?? v })"
          />
        </PropertyField>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <PropertyField :label="t('common.color', 'Color')">
          <UColorPicker
            :model-value="String(clip.style?.color ?? '#ffffff')"
            format="hex"
            size="sm"
            @update:model-value="(v: any) => emit('updateTextStyle', { color: String(v) })"
          />
        </PropertyField>
        <PropertyField :label="t('fastcat.textClip.backgroundColor', 'Background')">
          <UColorPicker
            :model-value="String(clip.style?.backgroundColor ?? '')"
            format="hex"
            size="sm"
            @update:model-value="
              (v: any) => emit('updateTextStyle', { backgroundColor: String(v) })
            "
          />
        </PropertyField>
      </div>

      <PropertyField :label="t('fastcat.textClip.width', 'Text width (0 - auto)')">
        <UiWheelNumberInput
          :model-value="Number(clip.style?.width ?? 0)"
          size="sm"
          :step="10"
          :min="0"
          @update:model-value="
            (v: any) => emit('updateTextStyle', { width: v > 0 ? Number(v) : undefined })
          "
        />
      </PropertyField>

      <PropertyField :label="t('fastcat.textClip.align', 'Align')">
        <USelectMenu
          :model-value="String(clip.style?.align ?? 'center')"
          :items="[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]"
          value-key="value"
          label-key="label"
          size="sm"
          @update:model-value="(v: any) => emit('updateTextStyle', { align: v })"
        />
      </PropertyField>

      <PropertyField :label="t('fastcat.textClip.verticalAlign', 'Vertical align')">
        <USelectMenu
          :model-value="String(clip.style?.verticalAlign ?? 'middle')"
          :items="[
            { value: 'top', label: 'Top' },
            { value: 'middle', label: 'Middle' },
            { value: 'bottom', label: 'Bottom' },
          ]"
          value-key="value"
          label-key="label"
          size="sm"
          @update:model-value="(v: any) => emit('updateTextStyle', { verticalAlign: v })"
        />
      </PropertyField>

      <div class="grid grid-cols-2 gap-2">
        <PropertyField :label="t('fastcat.textClip.lineHeight', 'Line height')">
          <UiWheelNumberInput
            :model-value="Number(clip.style?.lineHeight ?? 1.2)"
            size="sm"
            :step="0.1"
            @update:model-value="(v: any) => emit('updateTextStyle', { lineHeight: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="t('fastcat.textClip.letterSpacing', 'Letter spacing')">
          <UiWheelNumberInput
            :model-value="Number(clip.style?.letterSpacing ?? 0)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateTextStyle', { letterSpacing: Number(v) })"
          />
        </PropertyField>
      </div>

      <PropertyField :label="t('fastcat.textClip.padding', 'Padding')">
        <UiWheelNumberInput
          :model-value="
            (() => {
              const p = clip.style?.padding;
              if (typeof p === 'number' && Number.isFinite(p)) return p;
              if (p && typeof p === 'object') {
                if ('top' in p) return p.top ?? 60;
                if ('x' in p || 'y' in p) return ('y' in p ? p.y : p.x) ?? 60;
              }
              return 60;
            })()
          "
          size="sm"
          :step="1"
          :min="0"
          @update:model-value="(v: any) => emit('updateTextStyle', { padding: Number(v) })"
        />
      </PropertyField>
    </div>
  </PropertySection>
</template>
