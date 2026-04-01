<script setup lang="ts">
import { computed } from 'vue';
import { usePresetsStore } from '~/stores/presets.store';
import { useTimelineStore } from '~/stores/timeline.store';
import type { ShapeType, HudType, TextClipStyle } from '~/timeline/types';

const props = defineProps<{
  isOpen: boolean;
  type: 'text' | 'shape' | 'hud';
}>();

const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useI18n();
const timelineStore = useTimelineStore();
const presetsStore = usePresetsStore();

const isOpenLocal = computed({
  get: () => props.isOpen,
  set: (val) => {
    if (!val) emit('close');
  },
});

const drawerTitle = computed(() => {
  if (props.type === 'text') return t('fastcat.timeline.text', 'Text');
  if (props.type === 'shape') return t('fastcat.timeline.shape', 'Shape');
  return t('fastcat.timeline.hud', 'HUD');
});

interface PresetItem {
  id: string;
  name: string;
  icon: string;
  isCustom?: boolean;
  apply: () => void;
}

const textStandard: PresetItem[] = [
  {
    id: 'default',
    name: t('fastcat.library.texts.default', 'Default'),
    icon: 'i-heroicons-document-text',
    apply: () => {
      const trackId = timelineStore.resolveMobileTargetTrackId('video');
      timelineStore.addTextClipAtPlayhead({
        text: t('fastcat.timeline.textClipDefaultText', 'Text'),
        style: { fontSize: 64, color: '#ffffff', fontFamily: 'sans-serif' } as TextClipStyle,
        pseudo: true,
        trackId,
      });
    },
  },
  {
    id: 'title',
    name: t('fastcat.library.texts.title', 'Title'),
    icon: 'i-heroicons-h1',
    apply: () => {
      const trackId = timelineStore.resolveMobileTargetTrackId('video');
      timelineStore.addTextClipAtPlayhead({
        text: 'TITLE',
        style: {
          fontSize: 96,
          fontWeight: '800',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        } as TextClipStyle,
        pseudo: true,
        trackId,
      });
    },
  },
  {
    id: 'subtitle',
    name: t('fastcat.library.texts.subtitle', 'Subtitle'),
    icon: 'i-heroicons-h2',
    apply: () => {
      const trackId = timelineStore.resolveMobileTargetTrackId('video');
      timelineStore.addTextClipAtPlayhead({
        text: 'Subtitle',
        style: {
          fontSize: 48,
          fontWeight: '400',
          color: '#aaaaaa',
          fontFamily: 'sans-serif',
        } as TextClipStyle,
        pseudo: true,
        trackId,
      });
    },
  },
];

const shapeStandard: PresetItem[] = [
  {
    id: 'square',
    name: t('fastcat.library.shapes.square', 'Square'),
    icon: 'i-heroicons-stop',
    apply: () => {
      const trackId = timelineStore.resolveMobileTargetTrackId('video');
      timelineStore.addVirtualClipAtPlayhead({
        clipType: 'shape',
        name: 'Square',
        shapeType: 'square' as ShapeType,
        pseudo: true,
        trackId,
      });
    },
  },
  {
    id: 'circle',
    name: t('fastcat.library.shapes.circle', 'Circle'),
    icon: 'i-ph-circle',
    apply: () => {
      const trackId = timelineStore.resolveMobileTargetTrackId('video');
      timelineStore.addVirtualClipAtPlayhead({
        clipType: 'shape',
        name: 'Circle',
        shapeType: 'circle' as ShapeType,
        pseudo: true,
        trackId,
      });
    },
  },
  {
    id: 'triangle',
    name: t('fastcat.library.shapes.triangle', 'Triangle'),
    icon: 'i-ph-triangle',
    apply: () => {
      const trackId = timelineStore.resolveMobileTargetTrackId('video');
      timelineStore.addVirtualClipAtPlayhead({
        clipType: 'shape',
        name: 'Triangle',
        shapeType: 'triangle' as ShapeType,
        pseudo: true,
        trackId,
      });
    },
  },
  {
    id: 'star',
    name: t('fastcat.library.shapes.star', 'Star'),
    icon: 'i-heroicons-star',
    apply: () => {
      const trackId = timelineStore.resolveMobileTargetTrackId('video');
      timelineStore.addVirtualClipAtPlayhead({
        clipType: 'shape',
        name: 'Star',
        shapeType: 'star' as ShapeType,
        pseudo: true,
        trackId,
      });
    },
  },
  {
    id: 'cloud',
    name: t('fastcat.library.shapes.cloud', 'Cloud'),
    icon: 'i-heroicons-cloud',
    apply: () => {
      const trackId = timelineStore.resolveMobileTargetTrackId('video');
      timelineStore.addVirtualClipAtPlayhead({
        clipType: 'shape',
        name: 'Cloud',
        shapeType: 'cloud' as ShapeType,
        pseudo: true,
        trackId,
      });
    },
  },
  {
    id: 'speech_bubble',
    name: t('fastcat.library.shapes.speechBubble', 'Speech Bubble'),
    icon: 'i-heroicons-chat-bubble-left',
    apply: () => {
      const trackId = timelineStore.resolveMobileTargetTrackId('video');
      timelineStore.addVirtualClipAtPlayhead({
        clipType: 'shape',
        name: 'Speech Bubble',
        shapeType: 'speech_bubble' as ShapeType,
        pseudo: true,
        trackId,
      });
    },
  },
  {
    id: 'bang',
    name: t('fastcat.library.shapes.bang', 'Bang'),
    icon: 'i-heroicons-bolt',
    apply: () => {
      const trackId = timelineStore.resolveMobileTargetTrackId('video');
      timelineStore.addVirtualClipAtPlayhead({
        clipType: 'shape',
        name: 'Bang',
        shapeType: 'bang' as ShapeType,
        pseudo: true,
        trackId,
      });
    },
  },
];

const hudStandard: PresetItem[] = [
  {
    id: 'media_frame',
    name: t('fastcat.library.huds.mediaFrame', 'Media Frame'),
    icon: 'i-heroicons-photo',
    apply: () => {
      const trackId = timelineStore.resolveMobileTargetTrackId('video');
      timelineStore.addVirtualClipAtPlayhead({
        clipType: 'hud',
        name: 'Media Frame',
        hudType: 'media_frame' as HudType,
        pseudo: true,
        trackId,
      });
    },
  },
];

const standardItems = computed<PresetItem[]>(() => {
  if (props.type === 'text') return textStandard;
  if (props.type === 'shape') return shapeStandard;
  return hudStandard;
});

const customItems = computed<PresetItem[]>(() =>
  presetsStore.customPresets
    .filter((p) => p.category === props.type)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((p) => {
      const standardIcon =
        props.type === 'text'
          ? (textStandard.find((s) => s.id === p.baseType)?.icon ?? 'i-heroicons-document-text')
          : props.type === 'shape'
            ? (shapeStandard.find((s) => s.id === p.baseType)?.icon ?? 'i-heroicons-stop')
            : (hudStandard.find((s) => s.id === p.baseType)?.icon ?? 'i-heroicons-photo');

      return {
        id: p.id,
        name: p.name,
        icon: standardIcon,
        isCustom: true,
        apply: () => {
          const trackId = timelineStore.resolveMobileTargetTrackId('video');
          if (props.type === 'text') {
            timelineStore.addTextClipAtPlayhead({
              text: p.params?.text,
              style: p.params?.style,
              pseudo: true,
              trackId,
            });
          } else if (props.type === 'shape') {
            timelineStore.addVirtualClipAtPlayhead({
              clipType: 'shape',
              name: p.name,
              shapeType: p.baseType as ShapeType,
              pseudo: true,
              trackId,
            });
          } else {
            timelineStore.addVirtualClipAtPlayhead({
              clipType: 'hud',
              name: p.name,
              hudType: p.baseType as HudType,
              pseudo: true,
              trackId,
            });
          }
        },
      };
    }),
);

function selectPreset(item: PresetItem) {
  item.apply();
  emit('close');
}
</script>

<template>
  <UiMobileDrawer
    v-model:open="isOpenLocal"
    :title="drawerTitle"
    :snap-points="[1]"
    direction="bottom"
  >
    <div class="px-4 pb-8 overflow-y-auto">
      <!-- Standard presets -->
      <p class="text-xs font-semibold uppercase tracking-widest text-ui-text-muted px-1 mt-1 mb-3">
        {{ t('fastcat.effects.groups.standard', 'Standard') }}
      </p>

      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="item in standardItems"
          :key="item.id"
          class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-ui-border px-3 py-4 text-center transition-all active:scale-95"
          @click="selectPreset(item)"
        >
          <UIcon :name="item.icon" class="w-7 h-7 text-primary-400" />
          <span class="text-xs font-medium leading-tight text-ui-text">{{ item.name }}</span>
        </button>
      </div>

      <!-- Custom presets -->
      <template v-if="customItems.length > 0">
        <div class="h-px bg-ui-border my-4" />
        <p class="text-xs font-semibold uppercase tracking-widest text-ui-text-muted px-1 mb-3">
          {{ t('fastcat.effects.groups.custom', 'Custom') }}
        </p>
        <div class="grid grid-cols-3 gap-2">
          <button
            v-for="item in customItems"
            :key="item.id"
            class="flex flex-col items-center gap-2 rounded-2xl bg-ui-bg border border-primary-500/30 px-3 py-4 text-center transition-all active:scale-95"
            @click="selectPreset(item)"
          >
            <UIcon :name="item.icon" class="w-7 h-7 text-primary-400" />
            <span class="text-xs font-medium leading-tight text-ui-text">{{ item.name }}</span>
          </button>
        </div>
      </template>
    </div>
  </UiMobileDrawer>
</template>
