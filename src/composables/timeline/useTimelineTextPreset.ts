import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useTimelineStore } from '~/stores/timeline.store';
import { usePresetsStore } from '~/stores/presets.store';
import { useUiStore } from '~/stores/ui.store';
import type UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';

export function useTimelineTextPreset() {
  const { t } = useI18n();
  const timelineStore = useTimelineStore();
  const presetsStore = usePresetsStore();
  const uiStore = useUiStore();

  const textPresetMenuRef = ref<InstanceType<typeof UiContextMenuPortal> | null>(null);
  const { isTextPresetModalOpen: isPresetModalOpen, pendingTextPresetClipInfo: pendingClipInfo } =
    storeToRefs(uiStore);

  const standardPresets: Record<string, { style: Record<string, unknown>; text?: string }> = {
    default: {
      style: { fontSize: 64, color: '#ffffff', fontFamily: 'sans-serif', width: 1280 },
    },
    title: {
      style: { fontSize: 96, fontWeight: '800', color: '#ffffff', fontFamily: 'sans-serif', width: 1280 },
      text: t('videoEditor.library.texts.title'),
    },
    subtitle: {
      style: { fontSize: 48, fontWeight: '400', color: '#aaaaaa', fontFamily: 'sans-serif', width: 1280 },
      text: t('videoEditor.library.texts.subtitle'),
    },
  };

  function applyTextPreset(presetId: string, target?: { trackId: string; itemId: string }) {
    const trigger = target || uiStore.showTextPresetMenuTrigger;
    if (!trigger) return;

    const preset =
      standardPresets[presetId] ||
      presetsStore.customPresets.find((p) => p.id === presetId)?.params;

    if (preset) {
      const update: any = {
        style: JSON.parse(JSON.stringify(toRaw(preset.style))),
      };
      if (preset.text) {
        update.text = preset.text;
      }
      timelineStore.updateClipProperties(trigger.trackId, trigger.itemId, update);
    }

    if (target === pendingClipInfo.value) {
      pendingClipInfo.value = null;
      isPresetModalOpen.value = false;
    }
  }

  function showPresetModal(trackId: string, itemId: string) {
    pendingClipInfo.value = { trackId, itemId };
    isPresetModalOpen.value = true;
  }

  function cancelTextPreset() {
    const info = pendingClipInfo.value;
    if (info) {
      // Remove the pending clip — user cancelled preset selection
      timelineStore.applyTimeline(
        { type: 'delete_items', trackId: info.trackId, itemIds: [info.itemId] },
        { saveMode: 'none', skipHistory: true },
      );
    }
    pendingClipInfo.value = null;
    isPresetModalOpen.value = false;
  }

  const textPresetMenuItems = computed(() => {
    const standard = [
      {
        label: t('fastcat.library.texts.default', 'Default'),
        onSelect: () => applyTextPreset('default'),
      },
      {
        label: t('fastcat.library.texts.title', 'Title'),
        onSelect: () => applyTextPreset('title'),
      },
      {
        label: t('fastcat.library.texts.subtitle', 'Subtitle'),
        onSelect: () => applyTextPreset('subtitle'),
      },
    ];

    const custom = presetsStore.customPresets
      .filter((p) => p.category === 'text')
      .map((p) => ({
        label: p.name,
        onSelect: () => applyTextPreset(p.id),
      }));

    return [[...standard, ...custom]];
  });

  watch(
    () => uiStore.showTextPresetMenuTrigger,
    (val) => {
      if (val) {
        setTimeout(() => {
          textPresetMenuRef.value?.open({
            clientX: val.x,
            clientY: val.y,
          } as unknown as MouseEvent);
        }, 50);
      }
    },
  );

  return {
    textPresetMenuRef,
    textPresetMenuItems,
    isPresetModalOpen,
    pendingClipInfo,
    showPresetModal,
    cancelTextPreset,
    applyTextPreset,
  };
}
