<script setup lang="ts">
import { computed, watch } from 'vue';
import UiModal from '~/components/ui/UiModal.vue';
import type {
  ClipParameterGroupOption,
} from '~/utils/timeline/clip-parameters';

const props = defineProps<{
  groups: ClipParameterGroupOption[];
}>();

const isOpen = defineModel<boolean>('open', { default: false });
const selectedGroups = defineModel<string[]>('selectedGroups', {
  default: (): string[] => [],
});

const emit = defineEmits<{
  apply: [groups: string[]];
}>();

const { t } = useI18n();

const hasSelection = computed(() => selectedGroups.value.length > 0);

function getGroupSubProperties(groupId: string) {
  const group = props.groups.find((g) => g.id === groupId);
  return group?.subProperties ?? [];
}

function isGroupAllSelected(groupId: string): boolean {
  const subs = getGroupSubProperties(groupId);
  if (subs.length === 0) {
    return selectedGroups.value.includes(groupId);
  }
  return subs.every((sub) => selectedGroups.value.includes(sub.id));
}

function isGroupIndeterminate(groupId: string): boolean {
  const subs = getGroupSubProperties(groupId);
  if (subs.length === 0) return false;
  const selectedCount = subs.filter((sub) => selectedGroups.value.includes(sub.id)).length;
  return selectedCount > 0 && selectedCount < subs.length;
}

function toggleGroup(groupId: string, checked: boolean) {
  const subs = getGroupSubProperties(groupId);
  let nextSelected = [...selectedGroups.value];

  if (checked) {
    if (!nextSelected.includes(groupId)) {
      nextSelected.push(groupId);
    }
    for (const sub of subs) {
      if (!nextSelected.includes(sub.id)) {
        nextSelected.push(sub.id);
      }
    }
  } else {
    nextSelected = nextSelected.filter((id) => id !== groupId && !subs.some((sub) => sub.id === id));
  }
  selectedGroups.value = nextSelected;
}

function toggleSubProperty(groupId: string, subId: string, checked: boolean) {
  let nextSelected = [...selectedGroups.value];
  if (checked) {
    if (!nextSelected.includes(subId)) {
      nextSelected.push(subId);
    }
    const subs = getGroupSubProperties(groupId);
    if (subs.every((sub) => nextSelected.includes(sub.id)) && !nextSelected.includes(groupId)) {
      nextSelected.push(groupId);
    }
  } else {
    nextSelected = nextSelected.filter((id) => id !== subId);
    nextSelected = nextSelected.filter((id) => id !== groupId);
  }
  selectedGroups.value = nextSelected;
}

watch(
  () => [isOpen.value, props.groups] as const,
  ([open]) => {
    if (!open) return;
    const initialSelected: string[] = [];
    for (const group of props.groups) {
      if (group.selectedByDefault) {
        initialSelected.push(group.id);
        if (group.subProperties) {
          for (const sub of group.subProperties) {
            initialSelected.push(sub.id);
          }
        }
      }
    }
    selectedGroups.value = initialSelected;
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
    <div class="flex flex-col gap-3">
      <div v-for="group in groups" :key="group.id" class="flex flex-col gap-1.5">
        <UCheckbox
          :model-value="isGroupAllSelected(group.id)"
          :indeterminate="isGroupIndeterminate(group.id)"
          :label="t(group.labelKey)"
          @update:model-value="(checked) => toggleGroup(group.id, Boolean(checked))"
        />
        <div
          v-if="group.subProperties && group.subProperties.length > 0"
          class="pl-6 flex flex-col gap-1.5 border-l border-ui-border ml-2 mt-1"
        >
          <UCheckbox
            v-for="sub in group.subProperties"
            :key="sub.id"
            :model-value="selectedGroups.includes(sub.id)"
            :label="t(sub.labelKey)"
            @update:model-value="(checked) => toggleSubProperty(group.id, sub.id, Boolean(checked))"
          />
        </div>
      </div>
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
