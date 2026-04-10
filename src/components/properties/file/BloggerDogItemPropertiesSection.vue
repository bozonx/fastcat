<script setup lang="ts">
import { computed, ref } from 'vue';
import type { RemoteVfsFileEntry } from '~/types/remote-vfs';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import ExpandableYamlSection from '~/components/properties/file/ExpandableYamlSection.vue';
import { formatDurationSeconds } from '~/utils/format';
import yaml from 'js-yaml';

const props = defineProps<{
  item: RemoteVfsFileEntry;
  config: { baseUrl: string; bearerToken: string };
  title: string;
}>();

const { t } = useI18n();
const toast = useToast();

const duration = computed(() => {
  const dur = props.item.meta?.duration;
  if (typeof dur === 'number' && dur > 0) {
    return formatDurationSeconds(dur);
  }
  return null;
});

const isMetaExpanded = ref(false);
const rawMetaYaml = computed(() => {
  if (!props.item.meta) return null;
  const { duration, updatedAt, note, ...rest } = props.item.meta as any;
  if (Object.keys(rest).length === 0) return null;
  try {
    return yaml.dump(rest, { indent: 2 });
  } catch {
    return String(rest);
  }
});

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.add({ title: t('common.copiedToClipboard', 'Copied to clipboard') });
  } catch (e) {
    console.error('Failed to copy to clipboard', e);
  }
}
</script>

<template>
  <PropertySection :title="props.title">
    <template #header-actions>
      <div class="flex items-center gap-1">
        <slot name="header-actions" />
      </div>
    </template>

    <template #default>
      <PropertyRow :label="t('common.title', 'Title')">
        <span class="text-xs px-1">{{ props.item.title || props.item.name }}</span>
      </PropertyRow>

      <PropertyRow
        v-if="props.item.language"
        :label="t('common.language', 'Language')"
        :value="props.item.language"
      />

      <PropertyRow v-if="duration" :label="t('common.duration', 'Duration')" :value="duration" />

      <PropertyRow v-if="props.item.tags?.length" :label="t('common.tags', 'Tags')">
        <div class="flex flex-wrap gap-1">
          <span
            v-for="tag in props.item.tags"
            :key="tag"
            class="px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-400 text-[10px] font-medium border border-primary-500/20"
          >
            {{ tag }}
          </span>
        </div>
      </PropertyRow>

      <div
        v-if="props.item.text !== undefined"
        class="mt-2 flex flex-col gap-1.5 px-2 -mx-2 py-2 rounded bg-white/5 border border-white/10"
      >
        <div class="text-2xs text-ui-text-muted">
          <span>{{ t('common.text', 'Text') }}</span>
        </div>
        <div class="text-xs leading-relaxed whitespace-pre-wrap break-words">
          {{ props.item.text || '' }}
        </div>
      </div>

      <div
        v-if="props.item.note"
        class="mt-2 flex flex-col gap-1.5 px-2 -mx-2 py-2 rounded bg-white/5 border border-white/10"
      >
        <div class="text-2xs text-ui-text-muted">
          <span>{{ t('common.note', 'Note') }}</span>
        </div>
        <div class="text-xs leading-relaxed whitespace-pre-wrap">
          {{ props.item.note }}
        </div>
      </div>

      <!-- Metadata Section -->
      <ExpandableYamlSection
        v-if="rawMetaYaml"
        :title="t('common.meta', 'Meta (YAML)')"
        :content="rawMetaYaml"
        :expanded="isMetaExpanded"
        :on-toggle="() => (isMetaExpanded = !isMetaExpanded)"
        :on-copy="copyToClipboard"
      />

      <div v-if="$slots['after-content']" class="mt-4 pt-2 border-t border-ui-border">
        <slot name="after-content" />
      </div>
    </template>
  </PropertySection>
</template>
