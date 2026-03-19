<script setup lang="ts">
import UiModal from "~/components/ui/UiModal.vue";
import { ref } from 'vue';
import type { ShapeType, TimelineClipItem, TimelineTextClipItem } from '~/timeline/types';
import type { ParamControl } from '~/components/properties/params';
import PropertySection from '~/components/properties/PropertySection.vue';
import ParamsRenderer from '~/components/properties/ParamsRenderer.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import { usePresetsStore } from '~/stores/presets.store';
import PropertyField from '~/components/properties/PropertyField.vue';

const props = defineProps<{
  clip: TimelineClipItem;
  hudManifest: { controls: ParamControl[] } | null | undefined;
  hudControlValues: Record<string, unknown>;
}>();

const emit = defineEmits<{
  (e: 'updateBackgroundColor', val: string): void;
  (e: 'updateText', val: string): void;
  (e: 'updateTextStyle', patch: Record<string, unknown>): void;
  (e: 'updateShapeType', val: ShapeType): void;
  (e: 'updateFillColor', val: string): void;
  (e: 'updateStrokeColor', val: string): void;
  (e: 'updateStrokeWidth', val: number): void;
  (e: 'updateShapeConfig', patch: Record<string, unknown>): void;
  (e: 'updateHudControl', key: string, value: unknown): void;
}>();

const { t } = useI18n();
const presetsStore = usePresetsStore();

const isSaveModalOpen = ref(false);
const newPresetName = ref('');

function openSavePresetModal() {
  newPresetName.value = '';
  isSaveModalOpen.value = true;
}

function handleSavePreset() {
  const name = newPresetName.value.trim();
  if (!name) return;

  if (props.clip.clipType === 'shape') {
    const params = {
      shapeType: (props.clip as any).shapeType,
      fillColor: (props.clip as any).fillColor,
      strokeColor: (props.clip as any).strokeColor,
      strokeWidth: (props.clip as any).strokeWidth,
      shapeConfig: { ...((props.clip as any).shapeConfig || {}) },
    };
    presetsStore.saveAsPreset('shape', params.shapeType ?? 'square', name, params);
  } else if (props.clip.clipType === 'hud') {
    const params = {
      hudType: (props.clip as any).hudType,
      background: { ...((props.clip as any).background || {}) },
      content: { ...((props.clip as any).content || {}) },
    };
    presetsStore.saveAsPreset('hud', params.hudType ?? 'media_frame', name, params);
  }

  isSaveModalOpen.value = false;
}
</script>

<template>
  <UiModal
    v-model:open="isSaveModalOpen"
    :title="t('fastcat.effects.savePresetTitle', 'Save Preset')"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <UFormField :label="t('common.name', 'Name')">
          <UInput
            v-model="newPresetName"
            :placeholder="t('fastcat.effects.presetNamePlaceholder', 'My Custom Preset')"
            autofocus
            @keyup.enter="handleSavePreset"
          />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton variant="ghost" color="neutral" @click="isSaveModalOpen = false">
            {{ t('common.cancel', 'Cancel') }}
          </UButton>
          <UButton color="primary" :disabled="!newPresetName.trim()" @click="handleSavePreset">
            {{ t('common.save', 'Save') }}
          </UButton>
        </div>
      </div>
    </template>
  </UiModal>

  <!-- Background color -->
  <PropertySection v-if="props.clip.clipType === 'background'" :title="t('common.color', 'Color')">
    <div class="flex items-center justify-between gap-3">
      <span class="font-mono text-xs text-ui-text">{{ (props.clip as any).backgroundColor }}</span>
      <UColorPicker
        :model-value="(props.clip as any).backgroundColor"
        format="hex"
        size="sm"
        @update:model-value="emit('updateBackgroundColor', String($event))"
      />
    </div>
  </PropertySection>

  <!-- Text content -->
  <PropertySection
    v-else-if="props.clip.clipType === 'text'"
    :title="t('fastcat.textClip.text', 'Text')"
  >
    <div class="flex flex-col gap-2">
      <UTextarea
        :model-value="(props.clip as TimelineTextClipItem).text"
        size="sm"
        :rows="4"
        @update:model-value="emit('updateText', String($event))"
      />

      <PropertyField :label="t('fastcat.textClip.fontFamily', 'Font family')">

        <USelectMenu
          :model-value="
            String((props.clip as TimelineTextClipItem).style?.fontFamily ?? 'sans-serif')
          "
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
            :model-value="Number((props.clip as TimelineTextClipItem).style?.fontSize ?? 64)"
            size="sm"
            :step="1"
            :min="1"
            @update:model-value="(v: any) => emit('updateTextStyle', { fontSize: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="t('fastcat.textClip.fontWeight', 'Font weight')">
          <USelectMenu
            :model-value="String((props.clip as TimelineTextClipItem).style?.fontWeight ?? '700')"
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
            :model-value="String((props.clip as TimelineTextClipItem).style?.color ?? '#ffffff')"
            format="hex"
            size="sm"
            @update:model-value="(v: any) => emit('updateTextStyle', { color: String(v) })"
          />
        </PropertyField>
        <PropertyField :label="t('fastcat.textClip.backgroundColor', 'Background')">
          <UColorPicker
            :model-value="String((props.clip as TimelineTextClipItem).style?.backgroundColor ?? '')"
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
          :model-value="Number((props.clip as TimelineTextClipItem).style?.width ?? 0)"
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
          :model-value="String((props.clip as TimelineTextClipItem).style?.align ?? 'center')"
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
          :model-value="
            String((props.clip as TimelineTextClipItem).style?.verticalAlign ?? 'middle')
          "
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
            :model-value="Number((props.clip as TimelineTextClipItem).style?.lineHeight ?? 1.2)"
            size="sm"
            :step="0.1"
            @update:model-value="(v: any) => emit('updateTextStyle', { lineHeight: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="t('fastcat.textClip.letterSpacing', 'Letter spacing')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as TimelineTextClipItem).style?.letterSpacing ?? 0)"
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
              const p = (props.clip as TimelineTextClipItem).style?.padding;
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

  <!-- Shape content -->
  <PropertySection
    v-else-if="props.clip.clipType === 'shape'"
    :title="t('fastcat.shapeClip.shape', 'Shape')"
  >
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-end">
        <UButton
          size="xs"
          variant="ghost"
          color="primary"
          icon="i-heroicons-bookmark"
          :title="t('fastcat.effects.saveAsPreset', 'Save as preset')"
          @click="openSavePresetModal"
        />
      </div>
      <PropertyField :label="t('fastcat.shapeClip.type', 'Type')">
        <USelectMenu
          :model-value="String((props.clip as any).shapeType ?? 'square')"
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
          :model-value="String((props.clip as any).fillColor ?? '#ffffff')"
          format="hex"
          size="sm"
          @update:model-value="(v: any) => emit('updateFillColor', String(v))"
        />

      </PropertyField>

      <PropertyField :label="t('fastcat.shapeClip.strokeColor', 'Stroke Color')">

        <UColorPicker
          :model-value="String((props.clip as any).strokeColor ?? '#000000')"
          format="hex"
          size="sm"
          @update:model-value="(v: any) => emit('updateStrokeColor', String(v))"
        />

      </PropertyField>

      <PropertyField :label="t('fastcat.shapeClip.strokeWidth', 'Stroke Width')">

        <UiWheelNumberInput
          :model-value="Number((props.clip as any).strokeWidth ?? 0)"
          size="sm"
          :step="1"
          :min="0"
          @update:model-value="(v: any) => emit('updateStrokeWidth', Number(v))"
        />

      </PropertyField>

      <template v-if="(props.clip as any).shapeType === 'circle'">
        <PropertyField :label="$t('fastcat.shapeClip.squashX')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.squashX ?? 0)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { squashX: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.squashY')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.squashY ?? 0)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { squashY: Number(v) })"
          />
        </PropertyField>
      </template>

      <template v-else-if="(props.clip as any).shapeType === 'square'">
        <PropertyField :label="$t('fastcat.shapeClip.width')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.width ?? 100)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { width: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.height')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.height ?? 100)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { height: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.cornerRadius')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.cornerRadius ?? 0)"
            size="sm"
            :step="1"
            :min="0"
            :max="100"
            @update:model-value="(v: any) => emit('updateShapeConfig', { cornerRadius: Number(v) })"
          />
        </PropertyField>
      </template>

      <template v-else-if="(props.clip as any).shapeType === 'triangle'">
        <PropertyField :label="$t('fastcat.shapeClip.baseLength')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.baseLength ?? 100)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { baseLength: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.vertexOffset')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.vertexOffset ?? 50)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { vertexOffset: Number(v) })"
          />
        </PropertyField>
      </template>

      <template
        v-else-if="
          (props.clip as any).shapeType === 'star' || (props.clip as any).shapeType === 'bang'
        "
      >
        <PropertyField :label="$t('fastcat.clip.rays')">
          <UiWheelNumberInput
            :model-value="
              Number(
                (props.clip as any).shapeConfig?.rays ??
                  ((props.clip as any).shapeType === 'star' ? 5 : 12),
              )
            "
            size="sm"
            :step="1"
            :min="3"
            @update:model-value="(v: any) => emit('updateShapeConfig', { rays: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.innerRadius')">
          <UiWheelNumberInput
            :model-value="
              Number(
                (props.clip as any).shapeConfig?.innerRadius ??
                  ((props.clip as any).shapeType === 'star' ? 40 : 70),
              )
            "
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { innerRadius: Number(v) })"
          />
        </PropertyField>
      </template>

      <template v-else-if="(props.clip as any).shapeType === 'cloud'">
        <PropertyField :label="$t('fastcat.clip.cloudType')">
          <USelectMenu
            :model-value="String((props.clip as any).shapeConfig?.cloudType ?? '1')"
            :items="[
              { value: '1', label: `${t('fastcat.projects.projectNamePlaceholder').replace('Name', 'Type')} 1` },
              { value: '2', label: `${t('fastcat.projects.projectNamePlaceholder').replace('Name', 'Type')} 2` },
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

      <template v-else-if="(props.clip as any).shapeType === 'speech_bubble'">
        <PropertyField :label="$t('fastcat.shapeClip.width')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.width ?? 100)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { width: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.height')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.height ?? 70)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { height: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.cornerRadius')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.cornerRadius ?? 20)"
            size="sm"
            :step="1"
            :min="0"
            :max="100"
            @update:model-value="(v: any) => emit('updateShapeConfig', { cornerRadius: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.pointerSharpness')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.pointerSharpness ?? 40)"
            size="sm"
            :step="1"
            @update:model-value="
              (v: any) => emit('updateShapeConfig', { pointerSharpness: Number(v) })
            "
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.pointerAngle')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.pointerAngle ?? 20)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { pointerAngle: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.shapeClip.pointerX')">
          <UiWheelNumberInput
            :model-value="Number((props.clip as any).shapeConfig?.pointerX ?? 30)"
            size="sm"
            :step="1"
            @update:model-value="(v: any) => emit('updateShapeConfig', { pointerX: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="$t('fastcat.clip.pointerDirection')">
          <USelectMenu
            :model-value="String((props.clip as any).shapeConfig?.pointerDirection ?? 'left')"
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

  <!-- HUD content -->
  <PropertySection
    v-else-if="props.clip.clipType === 'hud'"
    :title="t('fastcat.hudClip.hud', 'HUD')"
  >
    <ParamsRenderer
      v-if="props.hudManifest"
      :controls="props.hudManifest.controls"
      :values="props.hudControlValues"
      @update:value="(key, value) => emit('updateHudControl', key, value)"
    />
  </PropertySection>
</template>
