<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useWorkspaceStore } from '~/stores/workspace.store';
import type { TimelineTextClipItem } from '~/timeline/types';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyField from '~/components/properties/PropertyField.vue';
import UiWheelNumberInput from '~/components/ui/UiWheelNumberInput.vue';
import UiSliderInput from '~/components/ui/UiSliderInput.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiTextarea from '~/components/ui/UiTextarea.vue';
import UiColorBlendPicker from '~/components/ui/UiColorBlendPicker.vue';
import UiTooltip from '~/components/ui/UiTooltip.vue';
import { getPlatformCapabilities } from '~/utils/capabilities';
import { nativeSystemFonts } from '~/utils/tauri-media-processing';
import { createDevLogger } from '~/utils/dev-logger';
import { computeTextLayoutMetrics } from '~/utils/video-editor/text-layout';
import { TRANSFORM_DESIGN_BASE } from '~/utils/video-editor/clip-layout';

const props = defineProps<{
  clip: TimelineTextClipItem;
  presets: Array<{ label: string; value: string }>;
  hidePresets?: boolean;
}>();

const emit = defineEmits<{
  (e: 'updateText' | 'loadPreset', val: string): void;
  (e: 'updateTextStyle', patch: Record<string, unknown>): void;
  (e: 'updateSnapToPixelGrid', val: boolean): void;
  (e: 'savePreset'): void;
}>();

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

const snapToPixelGrid = computed({
  get: () => Boolean(props.clip.snapToPixelGrid ?? false),
  set: (value: boolean) => emit('updateSnapToPixelGrid', value),
});

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
  const nextX = axis === 'x' ? safe : paddingLinked.value ? safe : getPaddingAxis('x');
  const nextY = axis === 'y' ? safe : paddingLinked.value ? safe : getPaddingAxis('y');

  emit('updateTextStyle', {
    padding: {
      top: nextY,
      right: nextX,
      bottom: nextY,
      left: nextX,
    },
  });
}

const backgroundEnabled = computed({
  get: () => Boolean(props.clip.style?.backgroundEnabled ?? props.clip.style?.backgroundColor),
  set: (value: boolean) => emit('updateTextStyle', { backgroundEnabled: value }),
});

const borderEnabled = computed({
  get: () => Boolean(props.clip.style?.borderEnabled),
  set: (value: boolean) => {
    const patch: Record<string, unknown> = { borderEnabled: value };
    if (value && props.clip.style?.borderWidth === undefined) {
      patch.borderWidth = 2;
    }
    emit('updateTextStyle', patch);
  },
});

const textShadowEnabled = computed({
  get: () => Boolean(props.clip.style?.textShadowEnabled),
  set: (value: boolean) => {
    const patch: Record<string, unknown> = { textShadowEnabled: value };
    if (value) {
      if (props.clip.style?.textShadowBlur === undefined) patch.textShadowBlur = 8;
      if (props.clip.style?.textShadowOffsetY === undefined) patch.textShadowOffsetY = 4;
      if (props.clip.style?.textShadowColor === undefined) patch.textShadowColor = '#000000';
    }
    emit('updateTextStyle', patch);
  },
});

const backgroundShadowEnabled = computed({
  get: () => Boolean(props.clip.style?.backgroundShadowEnabled),
  set: (value: boolean) => {
    const patch: Record<string, unknown> = { backgroundShadowEnabled: value };
    if (value) {
      if (props.clip.style?.backgroundShadowBlur === undefined) patch.backgroundShadowBlur = 12;
      if (props.clip.style?.backgroundShadowOffsetY === undefined)
        patch.backgroundShadowOffsetY = 6;
      if (props.clip.style?.backgroundShadowColor === undefined)
        patch.backgroundShadowColor = '#000000';
    }
    emit('updateTextStyle', patch);
  },
});

const paddingLinked = computed({
  get: () => props.clip.style?.paddingLinked !== false,
  set: (value: boolean) => {
    const patch: Record<string, unknown> = { paddingLinked: value };
    if (value) {
      const x = getPaddingAxis('x');
      patch.padding = { top: x, right: x, bottom: x, left: x };
    }
    emit('updateTextStyle', patch);
  },
});

const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const measureCtx = measureCanvas?.getContext('2d');

function computeCurrentAutoSize(): { width: number; height: number } {
  const text = props.clip.text ?? '';
  const style = props.clip.style;
  const canvasWidth = TRANSFORM_DESIGN_BASE.width;
  const canvasHeight = TRANSFORM_DESIGN_BASE.height;

  const layout = computeTextLayoutMetrics({
    text,
    style,
    canvasWidth,
    canvasHeight,
    designWidth: canvasWidth,
    designHeight: canvasHeight,
    measureText: (t, font) => {
      if (!measureCtx) return 0;
      measureCtx.font = font;
      return measureCtx.measureText(t).width;
    },
  });

  return {
    width: Math.max(1, Math.round(layout.frameWidth / layout.renderScale)),
    height: Math.max(1, Math.round(layout.frameHeight / layout.renderScale)),
  };
}

const isAutoWidth = computed({
  get: () => !(typeof props.clip.style?.width === 'number' && props.clip.style.width > 0),
  set: (value: boolean) => {
    if (!value) {
      const size = computeCurrentAutoSize();
      emit('updateTextStyle', { width: size.width });
    } else {
      emit('updateTextStyle', { width: undefined });
    }
  },
});

const isAutoHeight = computed({
  get: () => !(typeof props.clip.style?.height === 'number' && props.clip.style.height > 0),
  set: (value: boolean) => {
    if (!value) {
      const size = computeCurrentAutoSize();
      emit('updateTextStyle', { height: size.height });
    } else {
      emit('updateTextStyle', { height: undefined });
    }
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

// Curated list used in the web build, where these families are loaded from Google
// Fonts. In the desktop (Tauri) build we replace it with the fonts actually
// installed in the OS — see `fontFamilyOptions` below.
const webFontFamilyOptions = [
  { value: 'Inter', label: 'Inter' },
  { value: 'Roboto', label: 'Roboto' },
  { value: 'Montserrat', label: 'Montserrat' },
  { value: 'Oswald', label: 'Oswald' },
  { value: 'Noto Sans', label: 'Noto Sans' },
  { value: 'Playfair Display', label: 'Playfair Display' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Arial Black', label: 'Arial Black' },
  { value: 'Verdana', label: 'Verdana' },
  { value: 'Tahoma', label: 'Tahoma' },
  { value: 'Trebuchet MS', label: 'Trebuchet MS' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Impact', label: 'Impact' },
  { value: 'Bebas Neue', label: 'Bebas Neue' },
  { value: 'Rubik', label: 'Rubik' },
  { value: 'Fredoka', label: 'Fredoka' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Caveat', label: 'Caveat' },
  { value: 'sans-serif', label: 'Sans Serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
];

// Generic CSS families are always offered: the native renderer resolves them
// directly and they never depend on a specific installed font.
const genericFontFamilyOptions = [
  { value: 'sans-serif', label: 'Sans Serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Monospace' },
];

const log = createDevLogger('ClipTextProperties');
const systemFontFamilies = ref<string[]>([]);
const { systemFonts: supportsSystemFonts } = getPlatformCapabilities();

onMounted(async () => {
  if (!supportsSystemFonts) return;
  try {
    systemFontFamilies.value = await nativeSystemFonts();
  } catch (e) {
    log.warn('[fonts] failed to load system fonts, falling back to curated list:', e);
  }
});

const fontFamilyOptions = computed(() => {
  // Web build: curated Google-Fonts list.
  if (!supportsSystemFonts || systemFontFamilies.value.length === 0) {
    return webFontFamilyOptions;
  }

  // Desktop build: generic families + every font installed in the OS. Include the
  // clip's current family even if it is missing from the system, so the select
  // keeps showing the saved value instead of rendering blank.
  const options = [
    ...genericFontFamilyOptions,
    ...systemFontFamilies.value.map((name) => ({ value: name, label: name })),
  ];

  const current = props.clip.style?.fontFamily;
  if (typeof current === 'string' && current.length > 0) {
    const primary =
      current
        .split(',')[0]
        ?.trim()
        .replace(/^['"]|['"]$/g, '') ?? current;
    if (primary && !options.some((o) => o.value === primary)) {
      options.push({ value: primary, label: primary });
    }
  }

  return options;
});

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
            <div class="text-[10px] font-medium tracking-wider text-ui-text-muted/70">
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
          <PropertyField :label="t('fastcat.textClip.fontSizePx')">
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
            :show-blend-mode="false"
            @update:color="(v: string) => emit('updateTextStyle', { color: v })"
            @update:alpha="(v: number) => emit('updateTextStyle', { colorAlpha: v })"
          />
        </PropertyField>

        <div class="grid grid-cols-2 gap-2">
          <PropertyField :label="t('fastcat.textClip.lineHeightMultiplier')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.lineHeight ?? 1.2)"
              size="sm"
              :step="0.1"
              full-width
              @update:model-value="(v: any) => emit('updateTextStyle', { lineHeight: Number(v) })"
            />
          </PropertyField>
          <PropertyField :label="t('fastcat.textClip.letterSpacingPx')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.letterSpacing ?? 0)"
              size="sm"
              :step="1"
              full-width
              @update:model-value="
                (v: any) => emit('updateTextStyle', { letterSpacing: Number(v) })
              "
            />
          </PropertyField>
        </div>

        <template v-if="workspaceStore.inDevelopmentFeaturesEnabled">
          <div class="grid grid-cols-2 gap-2">
            <PropertyField :label="t('fastcat.textClip.widthMode')">
              <label class="h-8 flex items-center justify-between gap-2 cursor-pointer select-none">
                <span class="text-xs text-ui-text-muted">{{
                  t('fastcat.textClip.autoWidth')
                }}</span>
                <USwitch v-model="isAutoWidth" size="sm" color="error" />
              </label>
            </PropertyField>
            <PropertyField :label="t('fastcat.textClip.heightMode')">
              <label class="h-8 flex items-center justify-between gap-2 cursor-pointer select-none">
                <span class="text-xs text-ui-text-muted">{{
                  t('fastcat.textClip.autoHeight')
                }}</span>
                <USwitch v-model="isAutoHeight" size="sm" color="error" />
              </label>
            </PropertyField>
          </div>

          <div v-if="!isAutoWidth" class="grid grid-cols-2 gap-2">
            <PropertyField :label="t('fastcat.textClip.widthPx')">
              <UiWheelNumberInput
                :model-value="Number(clip.style?.width ?? 400)"
                size="sm"
                :step="10"
                :min="1"
                full-width
                @update:model-value="(v: any) => emit('updateTextStyle', { width: Number(v) })"
              />
            </PropertyField>
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
          </div>

          <div v-if="!isAutoHeight" class="grid grid-cols-2 gap-2">
            <PropertyField :label="t('fastcat.textClip.heightPx')">
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
        </template>
      </div>
    </PropertySection>

    <PropertySection
      v-model:enabled="textShadowEnabled"
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
        <div class="grid grid-cols-2 gap-2">
          <PropertyField :label="t('fastcat.textClip.shadowBlurPx')">
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
          <PropertyField :label="t('fastcat.textClip.shadowSpreadPx')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.textShadowSpread ?? 0)"
              size="sm"
              :step="1"
              :min="0"
              full-width
              @update:model-value="
                (v: any) => emit('updateTextStyle', { textShadowSpread: Number(v) })
              "
            />
          </PropertyField>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <PropertyField :label="t('fastcat.textClip.shadowOffsetXPx')">
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
          <PropertyField :label="t('fastcat.textClip.shadowOffsetYPx')">
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
      v-model:enabled="backgroundEnabled"
      :title="t('fastcat.textClip.backgroundBlock')"
      has-toggle
    >
      <div v-if="backgroundEnabled" class="flex flex-col gap-2">
        <PropertyField :label="t('fastcat.textClip.backgroundColor')">
          <UiColorBlendPicker
            :color="String(clip.style?.backgroundColor ?? '#000000')"
            :alpha="Number(clip.style?.backgroundAlpha ?? 1)"
            :show-blend-mode="false"
            @update:color="(v: string) => emit('updateTextStyle', { backgroundColor: v })"
            @update:alpha="(v: number) => emit('updateTextStyle', { backgroundAlpha: v })"
          />
        </PropertyField>
        <PropertyField :label="t('fastcat.textClip.backgroundRadiusPx')">
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
        <div class="grid grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] gap-2 items-end">
          <PropertyField :label="t('fastcat.textClip.horizontalPaddingPx')">
            <UiWheelNumberInput
              :model-value="getPaddingAxis('x')"
              size="sm"
              :step="1"
              :min="0"
              full-width
              @update:model-value="(v: any) => updatePaddingAxis('x', Number(v))"
            />
          </PropertyField>
          <div class="h-8 flex items-center justify-center">
            <UButton
              :icon="paddingLinked ? 'i-heroicons-link' : 'i-heroicons-link-slash'"
              variant="ghost"
              size="xs"
              color="white"
              square
              :title="t('fastcat.textClip.paddingLink')"
              @click="void (paddingLinked = !paddingLinked)"
            />
          </div>
          <PropertyField :label="t('fastcat.textClip.verticalPaddingPx')">
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
      </div>
    </PropertySection>

    <PropertySection
      v-if="backgroundEnabled"
      v-model:enabled="backgroundShadowEnabled"
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
        <div class="grid grid-cols-2 gap-2">
          <PropertyField :label="t('fastcat.textClip.shadowBlurPx')">
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
          <PropertyField :label="t('fastcat.textClip.shadowSpreadPx')">
            <UiWheelNumberInput
              :model-value="Number(clip.style?.backgroundShadowSpread ?? 0)"
              size="sm"
              :step="1"
              :min="0"
              full-width
              @update:model-value="
                (v: any) => emit('updateTextStyle', { backgroundShadowSpread: Number(v) })
              "
            />
          </PropertyField>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <PropertyField :label="t('fastcat.textClip.shadowOffsetXPx')">
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
          <PropertyField :label="t('fastcat.textClip.shadowOffsetYPx')">
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
      v-model:enabled="borderEnabled"
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
        <PropertyField :label="t('fastcat.textClip.borderWidthPx')">
          <UiWheelNumberInput
            :model-value="Number(clip.style?.borderWidth ?? 2)"
            size="sm"
            :step="1"
            :min="0"
            full-width
            @update:model-value="(v: any) => emit('updateTextStyle', { borderWidth: Number(v) })"
          />
        </PropertyField>
        <PropertyField :label="t('fastcat.textClip.borderOffsetPx')">
          <UiSliderInput
            :model-value="Number(clip.style?.borderOffset ?? 0)"
            :min="0"
            :max="50"
            :step="1"
            :decimals="0"
            :default-value="0"
            @update:model-value="
              (v: number) => emit('updateTextStyle', { borderOffset: Number(v) })
            "
          />
        </PropertyField>
      </div>
    </PropertySection>

    <PropertySection :title="t('fastcat.shapeClip.geometry')">
      <label class="flex items-center justify-between py-1 cursor-pointer select-none">
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-ui-text font-medium">{{
            t('fastcat.textClip.snapToPixelGrid')
          }}</span>
          <UiTooltip :text="t('fastcat.textClip.snapToPixelGridTooltip')" open-on-click>
            <button
              type="button"
              class="inline-flex items-center justify-center rounded p-0.5 text-ui-text-muted hover:text-ui-text focus:outline-none"
              :aria-label="t('fastcat.textClip.snapToPixelGridTooltip')"
            >
              <UIcon name="i-heroicons-information-circle" class="w-3.5 h-3.5" />
            </button>
          </UiTooltip>
        </div>
        <USwitch v-model="snapToPixelGrid" size="sm" />
      </label>
    </PropertySection>
  </div>
</template>
