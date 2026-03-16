<script setup lang="ts">
import { computed } from 'vue';
import { useProjectStore } from '~/stores/project.store';

const { t } = useI18n();
const projectStore = useProjectStore();

const metaTitle = computed({
  get: () => projectStore.projectMeta?.title || '',
  set: (val: string) => {
    if (projectStore.projectMeta) {
      projectStore.projectMeta.title = val;
    }
  },
});

const metaAuthor = computed({
  get: () => projectStore.projectMeta?.author || '',
  set: (val: string) => {
    if (projectStore.projectMeta) {
      projectStore.projectMeta.author = val;
    }
  },
});

const metaTagsString = computed({
  get: () => projectStore.projectMeta?.tags.join(', ') || '',
  set: (val: string) => {
    if (projectStore.projectMeta) {
      projectStore.projectMeta.tags = val
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }
  },
});

const metaDescription = computed({
  get: () => projectStore.projectMeta?.description || '',
  set: (val: string) => {
    if (projectStore.projectMeta) {
      projectStore.projectMeta.description = val;
    }
  },
});
</script>

<template>
  <div v-if="projectStore.projectSettings" class="space-y-4">
    <UFormField :label="t('videoEditor.export.metadataTitle', 'Title')">
      <UInput v-model="metaTitle" class="w-full" />
    </UFormField>

    <div class="grid grid-cols-2 gap-4">
      <UFormField :label="t('videoEditor.export.metadataAuthor', 'Author')">
        <UInput v-model="metaAuthor" class="w-full" />
      </UFormField>
      <UFormField :label="t('videoEditor.export.metadataTags', 'Tags')">
        <UInput v-model="metaTagsString" class="w-full" />
      </UFormField>
    </div>

    <UFormField :label="t('videoEditor.export.metadataDescription', 'Description')">
      <UTextarea v-model="metaDescription" :rows="2" class="w-full" />
    </UFormField>
  </div>
</template>
