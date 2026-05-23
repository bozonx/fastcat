<script setup lang="ts">
import { computed, watch } from 'vue';
import UiModal from '~/components/ui/UiModal.vue';
import type {
  ClipParameterGroup,
  ClipParameterGroupOption,
} from '~/utils/timeline/clip-parameters';

const props = defineProps<{
  groups: ClipParameterGroupOption[];
}>();

const isOpen = defineModel<boolean>('open', { default: false });
const selectedGroups = defineModel<string[]>('selectedGroups', { default: () => [] });

const emit = defineEmits<{
  apply: [groups: ClipParameterGroup[]];
}>();

const { t } = useI18n();

const hasSelection = computed(() => selectedGroups.value.length > 0);

watch(
  () => [isOpen.value, props.groups] as const,
  ([open]) => {
    if (!open) return;
    selectedGroups.value = props.groups
      .filter((group) => group.selectedByDefault)
      .map((group) => group.id);
  },
  { immediate: true },
);

function handleApply() {
  if (!hasSelection.value) return;
  emit('apply', [...selectedGroups.value]);
  isOpen.value = false;
}
</script>

<template>
  <UiModal
    v-model:open="isOpen"
    :title="t('fastcat.clip.parameters.pasteTitle')"
    :description="t('fastcat.clip.parameters.pasteDescription')"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <div class="flex flex-col gap-2">
      <UCheckbox
        v-for="group in groups"
        :key="group.id"
        v-model="selectedGroups"
        :value="group.id"
        :label="t(group.labelKey)"
      />
      <p v-if="groups.length === 0" class="text-sm text-ui-text-muted">
        {{ t('fastcat.clip.parameters.noApplicableGroups') }}
      </p>
    </div>

    <template #footer>
      <UButton color="neutral" variant="ghost" @click="isOpen = false">
        {{ t('common.cancel') }}
      </UButton>
      <UButton :disabled="!hasSelection" data-primary-focus="true" @click="handleApply">
        {{ t('fastcat.clip.parameters.apply') }}
      </UButton>
    </template>
  </UiModal>
</template>
