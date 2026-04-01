<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { getFileThumbnailHash, fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';

const props = defineProps<{
  projectId?: string;
  projectRelativePath?: string;
  projectName?: string;
}>();

const { t } = useI18n();
const url = ref<string | null>(null);

const load = () => {
  if (!props.projectId || !props.projectRelativePath) {
    url.value = null;
    return;
  }

  const hash = getFileThumbnailHash({
    projectId: props.projectId,
    projectRelativePath: props.projectRelativePath,
  });

  fileThumbnailGenerator.addTask({
    id: hash,
    projectId: props.projectId,
    projectRelativePath: props.projectRelativePath,
    onComplete: (newUrl) => {
      url.value = newUrl;
    },
    onError: () => {
      url.value = null;
    },
  });
};

onMounted(load);
watch(() => [props.projectId, props.projectRelativePath], load);
</script>

<template>
  <div
    class="relative w-full h-full bg-ui-bg-accent flex items-center justify-center overflow-hidden rounded-lg group"
  >
    <img
      v-if="url"
      :src="url"
      class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
      :alt="t('fastcat.startup.projectThumbnail')"
    />
    <div
      v-else
      class="flex flex-col items-center justify-center text-ui-text-muted gap-2 opacity-40"
    >
      <UIcon name="i-heroicons-film" class="w-10 h-10" />
    </div>

    <!-- Overlay Gradient -->
    <div
      class="absolute inset-0 bg-linear-to-t from-ui-bg/60 to-transparent pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
    />
  </div>
</template>
