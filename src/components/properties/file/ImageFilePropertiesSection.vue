<script setup lang="ts">
import PropertyRow from '~/components/properties/PropertyRow.vue';
import PropertySection from '~/components/properties/PropertySection.vue';
const props = defineProps<{
  imageResolution: string | null;
  imageCreateDate: string | null;
  imageLocationLink: string | null;
  imageCameraMake: string | null;
}>();

const { t } = useI18n();
</script>

<template>
  <PropertySection>
    <PropertyRow
      v-if="props.imageResolution"
      :label="t('videoEditor.fileManager.image.resolution')"
      :value="props.imageResolution"
    />
    <PropertyRow v-if="props.imageCreateDate" label="CreateDate" :value="props.imageCreateDate" />
    <PropertyRow
      v-if="props.imageLocationLink"
      :label="t('videoEditor.fileManager.image.location')"
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
      :label="t('videoEditor.fileManager.image.camera')"
      :value="props.imageCameraMake"
    />
  </PropertySection>
</template>
