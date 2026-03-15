<script setup lang="ts">
const props = defineProps<{
  imageResolution: string | null;
  imageCreateDate: string | null;
  imageLocationLink: string | null;
  imageCameraMake: string | null;
}>();

const { t } = useI18n();
</script>

<template>
  <div class="space-y-1 bg-ui-bg-elevated p-2 rounded border border-ui-border w-full">
    <div class="flex flex-col">
      <PropertyRow
        v-if="props.imageResolution"
        :label="t('videoEditor.fileManager.image.resolution', 'Resolution')"
        :value="props.imageResolution"
      />
      <PropertyRow v-if="props.imageCreateDate" label="CreateDate" :value="props.imageCreateDate" />
      <PropertyRow
        v-if="props.imageLocationLink"
        :label="t('videoEditor.fileManager.image.location', 'Location')"
      >
        <a
          class="text-primary-500 hover:underline break-all"
          :href="props.imageLocationLink"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google Maps
        </a>
      </PropertyRow>
      <PropertyRow
        v-if="props.imageCameraMake"
        :label="t('videoEditor.fileManager.image.camera', 'Camera')"
        :value="props.imageCameraMake"
      />
    </div>
  </div>
</template>
