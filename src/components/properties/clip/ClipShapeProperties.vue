<script setup lang="ts">
import type { ShapeType } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyField from '~/components/properties/PropertyField.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';

const props = defineProps<{
  clip: any;
}>();

const emit = defineEmits<{
  (e: 'updateShapeType', val: ShapeType): void;
  (e: 'updateFillColor', val: string): void;
  (e: 'updateStrokeColor', val: string): void;
  (e: 'updateStrokeWidth', val: number): void;
  (e: 'updateShapeConfig', patch: Record<string, unknown>): void;
  (e: 'openSavePresetModal'): void;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection :title="t('fastcat.shapeClip.shape', 'Shape')">
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-end">
        <UButton
          size="xs"
          variant="ghost"
          color="primary"
          icon="i-heroicons-bookmark"
          :title="t('fastcat.effects.saveAsPreset', 'Save as preset')"
          @click="emit('openSavePresetModal')"
        />
      </div>
      <PropertyField :label="t('fastcat.shapeClip.type', 'Type')">
        <USelectMenu
          :model-value="String(clip.shapeType ?? 'square')"
          :items="[
            { value: 'square', label: t('fastcat.shapeClip.types.square', 'Square') },
            { value: 'circle', label: t('fastcat.shapeClip.types.circle', 'Circle') },
            { value: 'triangle', label: t('fastcat.shapeClip.types.triangle', 'Triangle') },
            { value: 'star', label: t('fastcat.shapeClip.types.star', 'Star') },
            { value: 'bang', label: t('fastcat.shapeClip.types.bang', 'Bang') },
            { value: 'cloud', label: t('fastcat.shapeClip.types.cloud', 'Cloud') },
            {
              value: 'speech_bubble',
              label: t('fastcat.shapeClip.types.speechBubble', 'Speech Bubble'),
            },
          ]"
          value-key="value"
          label-key="label"
          size="sm"
          @update:model-value="(v: any) => emit('updateShapeType', v?.value ?? v)"
        />
      </PropertyField>

      <PropertyField :label="t('fastcat.shapeClip.fillColor', 'Fill Color')">
        <UColorPicker
          :model-value="String(clip.fillColor ?? '#ffffff')"
          format="hex"
          size="sm"
          @update:model-value="(v: any) => emit('updateFillColor', String(v))"
        />
      </PropertyField>

      <PropertyField :label="t('fastcat.shapeClip.strokeColor', 'Stroke Color')">
        <UColorPicker
          :model-value="String(clip.strokeColor ?? '#000000')"
          format="hex"
          size="sm"
          @update:model-value="(v: any) => emit('updateStrokeColor', String(v))"
        />
      </PropertyField>

      <PropertyField :label="t('fastcat.shapeClip.strokeWidth', 'Stroke Width')">
        <UiWheelNumberInput
          :model-value="Number(clip.strokeWidth ?? 0)"
          size="sm"
          :step="1"
          :min="0"
          @update:model-value="(v: any) => emit('updateStrokeWidth', Number(v))"
        />
      </PropertyField>

      <template v-if="clip.shapeType === 'circle'">
        <PropertyField :label="$t('fastcat.shapeClip.squashX')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.squashX ?? 0)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { squashX: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.squashY')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.squashY ?? 0)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { squashY: Number(v) })"
          />
        </PropertyField>
      </template>

      <template v-else-if="clip.shapeType === 'square'">
        <PropertyField :label="$t('fastcat.shapeClip.width')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.width ?? 100)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { width: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.height')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.height ?? 100)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { height: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.cornerRadius')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.cornerRadius ?? 0)"
            size="sm"
            :step="1"
            :min="0"
            :max="100"
            @update:model-value="(v: any) => emit('updateShapeConfig', { cornerRadius: Number(v) })"
          />
        </PropertyField>
      </template>

      <template v-else-if="clip.shapeType === 'triangle'">
        <PropertyField :label="$t('fastcat.shapeClip.baseLength')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.baseLength ?? 100)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { baseLength: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.vertexOffset')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.vertexOffset ?? 50)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { vertexOffset: Number(v) })"
          />
        </PropertyField>
      </template>

      <template v-else-if="clip.shapeType === 'star' || clip.shapeType === 'bang'">
        <PropertyField :label="$t('fastcat.clip.rays')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.rays ?? (clip.shapeType === 'star' ? 5 : 12))"
            size="sm"
            :step="1"
            :min="3"
            @update:model-value="(v: any) => emit('updateShapeConfig', { rays: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.innerRadius')">
          <UiWheelNumberInput
            :model-value="
              Number(clip.shapeConfig?.innerRadius ?? (clip.shapeType === 'star' ? 40 : 70))
            "
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { innerRadius: Number(v) })"
          />
        </PropertyField>
      </template>

      <template v-else-if="clip.shapeType === 'cloud'">
        <PropertyField :label="$t('fastcat.clip.cloudType')">
          <USelectMenu
            :model-value="String(clip.shapeConfig?.cloudType ?? '1')"
            :items="[
              {
                value: '1',
                label: `${t('fastcat.projects.projectNamePlaceholder').replace('Name', 'Type')} 1`,
              },
              {
                value: '2',
                label: `${t('fastcat.projects.projectNamePlaceholder').replace('Name', 'Type')} 2`,
              },
            ]"
            value-key="value"
            label-key="label"
            size="sm"
            @update:model-value="
              (v: any) => emit('updateShapeConfig', { cloudType: Number(v?.value ?? v) as 1 | 2 })
            "
          />
        </PropertyField>
      </template>

      <template v-else-if="clip.shapeType === 'speech_bubble'">
        <PropertyField :label="$t('fastcat.shapeClip.width')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.width ?? 100)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { width: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.height')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.height ?? 70)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { height: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.cornerRadius')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.cornerRadius ?? 20)"
            size="sm"
            :step="1"
            :min="0"
            :max="100"
            @update:model-value="(v: any) => emit('updateShapeConfig', { cornerRadius: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.pointerSharpness')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.pointerSharpness ?? 40)"
            size="sm"
            :step="1"
            @update:model-value="
              (v: any) => emit('updateShapeConfig', { pointerSharpness: Number(v) })
            "
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.pointerAngle')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.pointerAngle ?? 20)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { pointerAngle: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.pointerX')">
          <UiWheelNumberInput
            :model-value="Number(clip.shapeConfig?.pointerX ?? 30)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { pointerX: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.clip.pointerDirection')">
          <USelectMenu
            :model-value="String(clip.shapeConfig?.pointerDirection ?? 'left')"
            :items="[
              { value: 'left', label: $t('fastcat.timeline.transition.directionLeft') },
              { value: 'right', label: $t('fastcat.timeline.transition.directionRight') },
            ]"
            value-key="value"
            label-key="label"
            size="sm"
            @update:model-value="
              (v: any) => emit('updateShapeConfig', { pointerDirection: v?.value ?? v })
            "
          />
        </PropertyField>
      </template>
    </div>
  </PropertySection>
</template>
