<script setup lang="ts">
import { computed } from 'vue';
import type { RemoteVfsDirectoryEntry, RemoteVfsEntry } from '~/types/remote-vfs';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';

interface DirectoryWithMeta extends RemoteVfsDirectoryEntry {
  meta?: { updatedAt?: string };
}

const props = defineProps<{
  collection: RemoteVfsDirectoryEntry;
  config: { baseUrl: string; bearerToken: string };
}>();

const { t } = useI18n();

const itemsCount = computed(() => props.collection.itemsCount ?? 0);
const updatedAt = computed(() => {
  const collection = props.collection as DirectoryWithMeta;
  const date = collection.meta?.updatedAt;
  return date ? new Date(date).toLocaleString() : null;
});

const deepLink = computed(() => {
  if (!props.collection.id) return null;
  const baseUrl = props.config.baseUrl.replace(/\/api\/v1.*$/, '');
  return `${baseUrl}/content-library/collections/${props.collection.id}`;
});
</script>

<template>
  <PropertySection :title="t('fastcat.bloggerDog.collectionProperties', 'Свойства коллекции')">
    <template #default>
      <PropertyRow
        :label="t('fastcat.file.itemsCount', 'Количество элементов')"
        :value="itemsCount"
      />

      <PropertyRow v-if="updatedAt" :label="t('common.modified', 'Изменено')" :value="updatedAt" />

      <PropertyRow v-if="deepLink" :label="t('common.path', 'Путь')">
        <a
          :href="deepLink"
          target="_blank"
          class="text-primary-500 hover:text-primary-400 underline decoration-dotted transition-colors flex items-center gap-1 overflow-hidden"
        >
          <span class="truncate">{{ collection.name }}</span>
          <UIcon name="i-heroicons-arrow-top-right-on-square-20-solid" class="w-3 h-3 shrink-0" />
        </a>
      </PropertyRow>
    </template>
  </PropertySection>
</template>
