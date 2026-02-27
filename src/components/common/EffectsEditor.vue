<script setup lang="ts">
import { computed, ref } from 'vue';
import SelectEffectModal from '~/components/common/SelectEffectModal.vue';
import WheelSlider from '~/components/ui/WheelSlider.vue';
import { getEffectManifest } from '~/effects';
import type { ClipEffect } from '~/timeline/types';

const props = defineProps<{
  effects?: ClipEffect[];
  title?: string;
  addLabel?: string;
  emptyLabel?: string;
}>();

const emit = defineEmits<{
  'update:effects': [effects: ClipEffect[]];
}>();

const { t } = useI18n();

const isEffectModalOpen = ref(false);

const safeTitle = computed(() => props.title ?? t('granVideoEditor.effects.title', 'Effects'));
const safeAddLabel = computed(() => props.addLabel ?? t('granVideoEditor.effects.add', 'Add'));
const safeEmptyLabel = computed(
  () => props.emptyLabel ?? t('granVideoEditor.effects.empty', 'No effects'),
);

const safeEffects = computed(() => props.effects ?? []);

function setEffects(next: ClipEffect[]) {
  emit('update:effects', next);
}

function handleAddEffect(type: string) {
  const manifest = getEffectManifest(type);
  if (!manifest) return;

  const newEffect = {
    id: `effect_${Date.now()}`,
    type,
    enabled: true,
    ...manifest.defaultValues,
  } as unknown as ClipEffect;

  setEffects([...safeEffects.value, newEffect]);
}

function handleUpdateEffect(effectId: string, updates: Partial<ClipEffect>) {
  const next = safeEffects.value.map((e) =>
    e.id === effectId ? ({ ...e, ...updates } as ClipEffect) : e,
  );
  setEffects(next);
}

function handleRemoveEffect(effectId: string) {
  setEffects(safeEffects.value.filter((e) => e.id !== effectId));
}
</script>

<template>
  <div class="space-y-3 mt-2 bg-ui-bg-elevated p-4 rounded border border-ui-border text-sm">
    <div class="flex items-center justify-between">
      <span class="font-medium text-ui-text">{{ safeTitle }}</span>
      <UButton
        size="xs"
        variant="soft"
        color="primary"
        icon="i-heroicons-plus"
        @click="isEffectModalOpen = true"
      >
        {{ safeAddLabel }}
      </UButton>
    </div>

    <div v-if="safeEffects.length === 0" class="text-xs text-ui-text-muted text-center py-2">
      {{ safeEmptyLabel }}
    </div>

    <div class="space-y-2">
      <div
        v-for="effect in safeEffects"
        :key="effect.id"
        class="bg-ui-bg border border-ui-border rounded p-3"
      >
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <USwitch
              :model-value="effect.enabled"
              size="sm"
              @update:model-value="handleUpdateEffect(effect.id, { enabled: $event })"
            />
            <span class="font-medium">{{
              getEffectManifest(effect.type)?.name || effect.type
            }}</span>
          </div>
          <UButton
            size="xs"
            variant="ghost"
            color="red"
            icon="i-heroicons-trash"
            @click="handleRemoveEffect(effect.id)"
          />
        </div>

        <div class="space-y-3">
          <template
            v-for="control in getEffectManifest(effect.type)?.controls"
            :key="String(control.key)"
          >
            <div v-if="control.kind === 'slider'" class="flex flex-col gap-1">
              <div class="flex justify-between text-xs text-ui-text-muted">
                <span>{{ control.label }}</span>
                <span>
                  {{
                    control.format
                      ? control.format((effect as any)[control.key])
                      : (effect as any)[control.key]
                  }}
                </span>
              </div>
              <WheelSlider
                :model-value="(effect as any)[control.key]"
                :min="control.min"
                :max="control.max"
                :step="control.step"
                @update:model-value="handleUpdateEffect(effect.id, { [control.key]: $event })"
              />
            </div>
            <div v-else-if="control.kind === 'toggle'" class="flex items-center justify-between">
              <span class="text-xs text-ui-text-muted">{{ control.label }}</span>
              <USwitch
                :model-value="(effect as any)[control.key]"
                size="sm"
                @update:model-value="handleUpdateEffect(effect.id, { [control.key]: $event })"
              />
            </div>
          </template>
        </div>
      </div>
    </div>

    <SelectEffectModal v-model:open="isEffectModalOpen" @select="handleAddEffect" />
  </div>
</template>
