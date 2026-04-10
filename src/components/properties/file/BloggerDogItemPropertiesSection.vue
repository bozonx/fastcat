<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { RemoteVfsFileEntry } from '~/types/remote-vfs';
import PropertySection from '~/components/properties/PropertySection.vue';
import PropertyRow from '~/components/properties/PropertyRow.vue';
import ExpandableYamlSection from '~/components/properties/file/ExpandableYamlSection.vue';
import { formatDurationSeconds } from '~/utils/format';
import { useBloggerDogStore } from '~/stores/bloggerdog';
import yaml from 'js-yaml';

const props = defineProps<{
  item: RemoteVfsFileEntry;
  config: { baseUrl: string; bearerToken: string };
  title: string;
}>();

const { t } = useI18n();
const toast = useToast();
const bdStore = useBloggerDogStore();

const editTitle = ref(props.item.title || props.item.name || '');
const editTags = ref([...(props.item.tags || [])]);
const editLanguage = ref(props.item.language || '');
const editText = ref(props.item.text || '');
const editNote = ref(props.item.note || '');

const isSaving = ref(false);

watch(() => props.item, (newItem) => {
  editTitle.value = newItem.title || newItem.name || '';
  editTags.value = [...(newItem.tags || [])];
  editLanguage.value = newItem.language || '';
  editText.value = newItem.text || '';
  editNote.value = newItem.note || '';
}, { deep: true });

const hasChanges = computed(() => {
  return (
    editTitle.value !== (props.item.title || props.item.name || '') ||
    editTags.value.join(',') !== (props.item.tags || []).join(',') ||
    editLanguage.value !== (props.item.language || '') ||
    editText.value !== (props.item.text || '') ||
    editNote.value !== (props.item.note || '')
  );
});

async function onSave() {
  if (!hasChanges.value || isSaving.value) return;
  isSaving.value = true;
  try {
    await bdStore.updateItem({
      id: props.item.id,
      title: editTitle.value,
      text: editText.value,
      tags: editTags.value,
      note: editNote.value,
    });
    toast.add({ title: t('common.saved', 'Saved') });
  } catch (e: any) {
    toast.add({ 
      title: t('common.error', 'Error'), 
      description: e.message, 
      color: 'red' 
    });
  } finally {
    isSaving.value = false;
  }
}

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

function removeTag(index: number) {
  editTags.value.splice(index, 1);
}

const newTagInput = ref('');
function addTag() {
  const tag = newTagInput.value.trim();
  if (tag && !editTags.value.includes(tag)) {
    editTags.value.push(tag);
  }
  newTagInput.value = '';
}
</script>

<template>
  <PropertySection :title="props.title">
    <template #header-actions>
      <div class="flex items-center gap-1">
        <UButton
          v-if="hasChanges"
          size="xs"
          color="primary"
          icon="i-heroicons-check"
          :loading="isSaving"
          @click="onSave"
        >
          {{ t('common.save', 'Save') }}
        </UButton>
        <slot name="header-actions" />
      </div>
    </template>

    <template #default>
      <PropertyRow :label="t('common.title', 'Title')">
        <UInput v-model="editTitle" size="xs" variant="none" class="bg-white/5 rounded" />
      </PropertyRow>

      <PropertyRow 
        v-if="editLanguage" 
        :label="t('common.language', 'Language')" 
        :value="editLanguage" 
      />
      
      <PropertyRow 
        v-if="duration" 
        :label="t('common.duration', 'Duration')" 
        :value="duration" 
      />

      <PropertyRow :label="t('common.tags', 'Tags')">
        <div class="flex flex-col gap-2">
          <div class="flex flex-wrap gap-1">
            <span 
              v-for="(tag, idx) in editTags" 
              :key="tag"
              class="px-1.5 py-0.5 rounded bg-primary-500/10 text-primary-400 text-[10px] font-medium border border-primary-500/20 flex items-center gap-1"
            >
              {{ tag }}
              <button 
                class="hover:text-primary-300 transition-colors"
                @click="removeTag(idx)"
              >
                <UIcon name="i-heroicons-x-mark" class="w-2.5 h-2.5" />
              </button>
            </span>
          </div>
          <div class="flex items-center gap-1">
            <UInput 
              v-model="newTagInput" 
              size="2xs" 
              placeholder="Add tag..." 
              class="flex-1"
              @keydown.enter="addTag" 
            />
            <UButton 
              size="2xs" 
              icon="i-heroicons-plus" 
              variant="ghost" 
              color="neutral" 
              @click="addTag" 
            />
          </div>
        </div>
      </PropertyRow>

      <div class="mt-4 flex flex-col gap-1.5 px-2 -mx-2 py-2 rounded bg-white/5 border border-white/10">
        <div class="text-2xs text-ui-text-muted">
          <span>{{ t('common.text', 'Text') }}</span>
        </div>
        <UTextarea 
          v-model="editText" 
          autoresize 
          size="xs" 
          variant="none" 
          class="bg-transparent italic leading-relaxed" 
          :placeholder="t('common.noText', 'No text')"
        />
      </div>

      <div class="mt-2 flex flex-col gap-1.5 px-2 -mx-2 py-2 rounded bg-white/5 border border-white/10">
        <div class="text-2xs text-ui-text-muted">
          <span>{{ t('common.note', 'Note') }}</span>
        </div>
        <UTextarea 
          v-model="editNote" 
          autoresize 
          size="xs" 
          variant="none" 
          class="bg-transparent leading-relaxed" 
          :placeholder="t('common.noNote', 'No note')"
        />
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
