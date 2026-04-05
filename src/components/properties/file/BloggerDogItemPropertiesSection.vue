<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RemoteVfsFileEntry } from '~/types/remote-vfs';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import ExpandableYamlSection from '~/components/properties/file/ExpandableYamlSection.vue';
import { formatDurationSeconds } from '~/utils/format';

const props = defineProps<{
  item: RemoteVfsFileEntry;
}>();

const { t } = useI18n();

const tags = computed(() => props.item.tags || []);
const hasTags = computed(() => tags.value.length > 0);
const language = computed(() => props.item.language || '');
const text = computed(() => props.item.text || '');
const hasText = computed(() => text.value.trim().length > 0);

const duration = computed(() => {
  const dur = props.item.meta?.duration;
  if (typeof dur === 'number' && dur > 0) {
    return formatDurationSeconds(dur);
  }
  return null;
});

import yaml from 'js-yaml';
const isMetaExpanded = ref(false);
const rawMetaYaml = computed(() => {
  if (!props.item.meta) return null;
  // Exclude fields we already display to avoid duplication
  const { duration, updatedAt, ...rest } = props.item.meta as any;
  if (Object.keys(rest).length === 0) return null;
  try {
    return yaml.dump(rest, { indent: 2 });
  } catch {
    return String(rest);
  }
});
</script>

<template>
  <PropertySection title="BloggerDog">
    <PropertyRow 
      v-if="language" 
      :label="t('common.language', 'Language')" 
      :value="language" 
    />
    
    <PropertyRow 
      v-if="duration" 
      :label="t('common.duration', 'Duration')" 
      :value="duration" 
    />

    <PropertyRow v-if="hasTags" :label="t('common.tags', 'Tags')">
      <div class="flex flex-wrap gap-1">
        <span 
          v-for="tag in tags" 
          :key="tag"
          class="px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-400 text-[10px] font-medium border border-primary-500/20"
        >
          {{ tag }}
        </span>
      </div>
    </PropertyRow>

    <div v-if="hasText" class="mt-2 flex flex-col gap-1.5 px-2 -mx-2 py-2 rounded bg-white/5 border border-white/10">
      <div class="text-2xs text-ui-text-muted flex items-center justify-between">
        <span>{{ t('common.text', 'Text') }}</span>
      </div>
      <div class="text-xs text-ui-text-muted line-clamp-6 leading-relaxed italic wrap-break-word">
        "{{ text }}"
      </div>
    </div>

    <!-- Metadata Section (Excluding displayed fields) -->
    <ExpandableYamlSection
      v-if="rawMetaYaml"
      :title="t('common.meta', 'Meta (YAML)')"
      :content="rawMetaYaml"
      :expanded="isMetaExpanded"
      :on-toggle="() => (isMetaExpanded = !isMetaExpanded)"
      :on-copy="undefined"
    />
  </PropertySection>
</template>
