import { computed, ref, watch } from 'vue';
import { useTimelineStore } from '~/stores/timeline.store';
import { usePresetsStore } from '~/stores/presets.store';
import { useUiStore } from '~/stores/ui.store';
import UiContextMenuPortal from '~/components/ui/UiContextMenuPortal.vue';

export function useTimelineTextPreset() {
  const { t } = useI18n();
  const timelineStore = useTimelineStore();
  const presetsStore = usePresetsStore();
  const uiStore = useUiStore();

  const textPresetMenuRef = ref<InstanceType<typeof UiContextMenuPortal> | null>(null);

  const standardPresets: Record<string, { style: Record<string, unknown> }> = {
    default: {
      style: { fontSize: 64, color: '#ffffff', fontFamily: 'sans-serif' },
    },
    title: {
      style: { fontSize: 96, fontWeight: '800', color: '#ffffff', fontFamily: 'sans-serif' },
    },
    subtitle: {
      style: { fontSize: 48, fontWeight: '400', color: '#aaaaaa', fontFamily: 'sans-serif' },
    },
  };

  function applyTextPreset(presetId: string) {
    const trigger = uiStore.showTextPresetMenuTrigger;
    if (!trigger) return;

    const preset =
      standardPresets[presetId] ||
      presetsStore.customPresets.find((p) => p.id === presetId)?.params;

    if (preset) {
      timelineStore.updateClipProperties(trigger.trackId, trigger.itemId, {
        style: preset.style,
      });
    }
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
          textPresetMenuRef.value?.open({ clientX: val.x, clientY: val.y } as unknown as MouseEvent);
        }, 50);
      }
    },
  );

  return { textPresetMenuRef, textPresetMenuItems };
}
