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
}>();

const { t } = useI18n();
const toast = useToast();
const uiStore = useUiStore();

const isEditing = ref(false);
const isSaving = ref(false);
const editName = ref('');
const editTags = ref('');
const editNote = ref('');

const tags = computed(() => props.item.tags || []);
const hasTags = computed(() => tags.value.length > 0);
const language = computed(() => props.item.language || '');
const text = computed(() => props.item.text || '');
const hasText = computed(() => text.value.trim().length > 0);
const note = computed(() => props.item.note || '');
const hasNote = computed(() => note.value.trim().length > 0);

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
  // Exclude fields we already display to avoid duplication
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

const startEditing = () => {
  editName.value = props.item.title || props.item.name || '';
  editTags.value = tags.value.join(', ');
  editNote.value = props.item.note || '';
  isEditing.value = true;
};

const onSave = async () => {
  if (isSaving.value || !props.config) return;
  isSaving.value = true;
  try {
    const { renameRemoteItem } = await import('~/utils/remote-vfs');
    await renameRemoteItem({
      config: props.config,
      id: props.item.id,
      name: editName.value.trim() || undefined,
      tags: editTags.value.split(',').map((t) => t.trim()).filter(Boolean),
      note: editNote.value.trim() || '',
    });
    
    toast.add({ title: t('common.saved', 'Saved successfully') });
    isEditing.value = false;
    uiStore.notifyFileManagerUpdate();
  } catch (error) {
    console.error('[BloggerDog] Failed to update item properties', error);
    toast.add({ 
      title: t('common.error', 'Error'), 
      description: error instanceof Error ? error.message : String(error), 
      color: 'red' 
    });
  } finally {
    isSaving.value = false;
  }
};
</script>

<template>
  <PropertySection title="BloggerDog">
    <template #header-actions>
      <div class="flex items-center gap-1">
        <UButton
          v-if="!isEditing"
          color="neutral"
          variant="ghost"
          icon="i-heroicons-pencil-square"
          size="2xs"
          class="-my-1"
          @click="startEditing"
        />
        <slot name="header-actions" />
      </div>
    </template>

    <div v-if="isEditing" class="flex flex-col gap-3 py-1">
      <div class="flex flex-col gap-1">
        <div class="text-2xs text-ui-text-muted px-1">{{ t('common.name', 'Title') }}</div>
        <UInput v-model="editName" size="sm" :placeholder="t('common.name', 'Name')" />
      </div>

      <div class="flex flex-col gap-1">
        <div class="text-2xs text-ui-text-muted px-1">{{ t('common.tags', 'Tags') }}</div>
        <UInput v-model="editTags" size="sm" :placeholder="t('common.tags', 'Tags (comma separated)')" />
      </div>

      <div class="flex flex-col gap-1">
        <div class="text-2xs text-ui-text-muted px-1">{{ t('common.note', 'Note') }}</div>
        <UTextarea v-model="editNote" :rows="3" size="sm" :placeholder="t('common.note', 'Note')" />
      </div>

      <div class="flex items-center gap-2 pt-1 justify-end">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="isSaving"
          @click="isEditing = false"
        >
          {{ t('common.cancel', 'Cancel') }}
        </UButton>
        <UButton
          color="primary"
          size="sm"
          :loading="isSaving"
          @click="onSave"
        >
          {{ t('common.save', 'Save') }}
        </UButton>
      </div>
    </div>

    <template v-else>
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

      <div v-if="hasNote" class="mt-2 flex flex-col gap-1.5 px-2 -mx-2 py-2 rounded bg-white/5 border border-white/10">
        <div class="text-2xs text-ui-text-muted flex items-center justify-between">
          <span>{{ t('common.note', 'Note') }}</span>
        </div>
        <div class="text-xs text-ui-text-muted line-clamp-6 leading-relaxed wrap-break-word">
          {{ note }}
        </div>
      </div>

      <!-- Metadata Section (Excluding displayed fields) -->
      <ExpandableYamlSection
        v-if="rawMetaYaml"
        :title="t('common.meta', 'Meta (YAML)')"
        :content="rawMetaYaml"
        :expanded="isMetaExpanded"
        :on-toggle="() => (isMetaExpanded = !isMetaExpanded)"
        :on-copy="copyToClipboard"
      />
    </template>

    <div v-if="$slots['after-content']" class="mt-4 pt-2 border-t border-ui-border">
      <slot name="after-content" />
    </div>
  </PropertySection>
</template>
