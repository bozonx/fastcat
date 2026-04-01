<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { getFileThumbnailHash, fileThumbnailGenerator } from '~/utils/file-thumbnail-generator';

const props = withDefaults(defineProps<{
  projectId?: string;
  projectRelativePath?: string;
  projectName?: string;
  variant?: 'desktop' | 'mobile';
}>(), {
  variant: 'desktop'
});

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
    class="relative w-full h-full bg-slate-900 flex items-center justify-center overflow-hidden group"
    :class="[
      variant === 'desktop' ? 'aspect-video' : 'aspect-3/4'
    ]"
  >
    <img
      v-if="url"
      :src="url"
      class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
      :alt="t('fastcat.startup.projectThumbnail')"
    />
    <div
      v-else
      class="flex flex-col items-center justify-center text-ui-text-muted gap-3 opacity-30 group-hover:opacity-50 transition-opacity"
    >
      <div class="p-3 rounded-2xl bg-white/5 border border-white/5">
        <UIcon name="i-heroicons-film" class="w-8 h-8 md:w-10 md:h-10" />
      </div>
    </div>

    <!-- Overlay Gradient for better text readability -->
    <div
      class="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent pointer-events-none opacity-60 group-hover:opacity-40 transition-opacity"
    />
  </div>
</template>
