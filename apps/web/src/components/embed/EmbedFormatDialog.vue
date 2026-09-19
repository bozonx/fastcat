<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import UiAdaptiveDialog from '~/components/ui/UiAdaptiveDialog.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { createManualTimelineFormat, isTimelineGeometryUnresolved } from '~/timeline/format';

/**
 * Picks the resolution and frame rate of the video the session renders.
 *
 * Edits a copy and writes it on confirm, so browsing the presets does not
 * re-lay-out the timeline under the user at every click.
 */
const props = defineProps<{
  /** `export` goes straight on to render once the format is applied. */
  purpose: 'edit' | 'export';
}>();

const isOpen = defineModel<boolean>('open', { required: true });

const emit = defineEmits<{ applied: [] }>();

const { t } = useI18n();
const timelineStore = useTimelineStore();

const width = ref(0);
const height = ref(0);
const fps = ref(0);
const resolutionFormat = ref('');
const orientation = ref<'landscape' | 'portrait'>('landscape');
const aspectRatio = ref('');
const isCustomResolution = ref(false);

const isUnresolved = ref(false);

watch(
  isOpen,
  (open) => {
    if (!open) return;
    const format = timelineStore.timelineFormat;
    width.value = format.width;
    height.value = format.height;
    fps.value = format.fps;
    resolutionFormat.value = format.resolutionFormat;
    orientation.value = format.orientation;
    aspectRatio.value = format.aspectRatio;
    isCustomResolution.value = format.isCustomResolution;
    isUnresolved.value = isTimelineGeometryUnresolved(format);
  },
  { immediate: true },
);

const description = computed(() =>
  isUnresolved.value
    ? t('fastcat.embed.format.dialogUnresolved')
    : t('fastcat.embed.format.dialogResolved'),
);

async function apply() {
  await timelineStore.updateTimelineFormat(
    createManualTimelineFormat(timelineStore.timelineFormat, {
      width: width.value,
      height: height.value,
      fps: fps.value,
      resolutionFormat: resolutionFormat.value,
      orientation: orientation.value,
      aspectRatio: aspectRatio.value,
      isCustomResolution: isCustomResolution.value,
    }),
  );
  isOpen.value = false;
  emit('applied');
}
</script>

<template>
  <UiAdaptiveDialog
    v-model:open="isOpen"
    :title="t('fastcat.embed.format.dialogTitle')"
    :description="description"
  >
    <div data-testid="embed-format-dialog">
      <MediaResolutionSettings
        v-model:width="width"
        v-model:height="height"
        v-model:fps="fps"
        v-model:resolution-format="resolutionFormat"
        v-model:orientation="orientation"
        v-model:aspect-ratio="aspectRatio"
        v-model:is-custom-resolution="isCustomResolution"
        :show-audio-settings="false"
      />
    </div>

    <template #footer>
      <UButton
        color="neutral"
        variant="ghost"
        :label="t('common.cancel')"
        @click="isOpen = false"
      />
      <UButton
        color="primary"
        data-testid="embed-format-apply"
        :label="
          props.purpose === 'export'
            ? t('fastcat.embed.format.applyAndExport')
            : t('fastcat.embed.format.apply')
        "
        @click="apply"
      />
    </template>
  </UiAdaptiveDialog>
</template>
