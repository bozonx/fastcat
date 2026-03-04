<script setup lang="ts">
import { ref, computed } from 'vue';
import { getAllEffectManifests } from '~/effects';
import { getAllTransitionManifests } from '~/transitions';

const { t } = useI18n();

const activeTab = ref<'video' | 'transitions' | 'audio'>('video');

const effects = computed(() => getAllEffectManifests());
const transitions = computed(() => getAllTransitionManifests());

function handleDragStart(event: DragEvent, type: string, category: 'effect' | 'transition') {
  if (!event.dataTransfer) return;
  event.dataTransfer.setData(`gran-${category}`, type);
  event.dataTransfer.effectAllowed = 'copy';
}
</script>

<template>
  <div class="flex flex-col h-full bg-ui-bg-elevated text-sm relative min-h-0">
    <!-- Tabs -->
    <div class="flex items-center border-b border-ui-border shrink-0 px-2 pt-2 gap-1 bg-ui-bg-elevated sticky top-0 z-10">
      <button
        class="px-3 py-1.5 rounded-t-lg transition-colors border border-b-0 border-transparent font-medium"
        :class="
          activeTab === 'video'
            ? 'bg-ui-bg text-primary-400 border-ui-border'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover'
        "
        @click="activeTab = 'video'"
      >
        {{ t('granVideoEditor.effects.tabs.video', 'Video') }}
      </button>
      <button
        class="px-3 py-1.5 rounded-t-lg transition-colors border border-b-0 border-transparent font-medium"
        :class="
          activeTab === 'transitions'
            ? 'bg-ui-bg text-primary-400 border-ui-border'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover'
        "
        @click="activeTab = 'transitions'"
      >
        {{ t('granVideoEditor.effects.tabs.transitions', 'Transitions') }}
      </button>
      <button
        class="px-3 py-1.5 rounded-t-lg transition-colors border border-b-0 border-transparent font-medium"
        :class="
          activeTab === 'audio'
            ? 'bg-ui-bg text-primary-400 border-ui-border'
            : 'text-ui-text-muted hover:text-ui-text hover:bg-ui-bg-hover'
        "
        @click="activeTab = 'audio'"
      >
        {{ t('granVideoEditor.effects.tabs.audio', 'Audio') }}
      </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto bg-ui-bg p-3">
      <!-- Video Effects -->
      <div v-show="activeTab === 'video'" class="grid grid-cols-1 gap-2 pb-4">
        <div
          v-for="effect in effects"
          :key="effect.type"
          class="flex items-start gap-3 p-3 rounded-lg border border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated cursor-grab active:cursor-grabbing transition-colors"
          draggable="true"
          @dragstart="handleDragStart($event, effect.type, 'effect')"
        >
          <UIcon :name="effect.icon" class="w-8 h-8 text-primary shrink-0" />
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-medium text-ui-text">{{ effect.name }}</h4>
            <p class="text-xs text-ui-text-muted mt-1 line-clamp-2" :title="effect.description">{{ effect.description }}</p>
          </div>
        </div>
        
        <div v-if="effects.length === 0" class="col-span-full text-center text-ui-text-muted py-8 italic">
          {{ t('common.noData') }}
        </div>
      </div>

      <!-- Transitions -->
      <div v-show="activeTab === 'transitions'" class="grid grid-cols-1 gap-2 pb-4">
        <div
          v-for="transition in transitions"
          :key="transition.type"
          class="flex items-center gap-3 p-3 rounded-lg border border-ui-border bg-ui-bg-muted hover:bg-ui-bg-elevated cursor-grab active:cursor-grabbing transition-colors"
          draggable="true"
          @dragstart="handleDragStart($event, transition.type, 'transition')"
        >
          <UIcon :name="transition.icon" class="w-8 h-8 text-primary shrink-0" />
          <div class="flex-1 min-w-0">
            <h4 class="text-sm font-medium text-ui-text">{{ transition.name }}</h4>
          </div>
        </div>
        
        <div v-if="transitions.length === 0" class="col-span-full text-center text-ui-text-muted py-8 italic">
          {{ t('common.noData') }}
        </div>
      </div>

      <!-- Audio Effects -->
      <div v-show="activeTab === 'audio'" class="flex flex-col items-center justify-center h-full min-h-50 text-ui-text-disabled py-8 text-center">
        <UIcon name="i-heroicons-musical-note" class="w-10 h-10 mb-3" />
        <p class="text-sm italic">
          {{ t('common.noData', '(coming soon)') }}
        </p>
      </div>
    </div>
  </div>
</template>
