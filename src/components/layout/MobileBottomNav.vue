<script setup lang="ts">
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

const props = defineProps<{
  activeTab?: 'files' | 'edit' | 'export' | 'settings';
}>();

const emit = defineEmits<{
  (e: 'update:activeTab', value: 'files' | 'edit' | 'export' | 'settings'): void;
}>();

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const workspaceStore = useWorkspaceStore();
const { leaveProject } = useProjectActions();
const fileManagerStore = useFileManagerStore();

const lastProjectName = computed(() => workspaceStore.lastProjectName);
const isEditorPage = computed(() => route.path.startsWith('/m/editor/'));

// Panels should be hidden on home if no last-project
const showNav = computed(() => {
  if (isEditorPage.value) return true;
  return !!lastProjectName.value;
});

const navItems = computed(() => [
  { id: 'home', label: t('common.toHome'), icon: 'lucide:home' },
  { id: 'files', label: t('common.files'), icon: 'lucide:folder-open' },
  { id: 'edit', label: t('common.edit'), icon: 'lucide:clapperboard' },
  { id: 'export', label: t('common.export'), icon: 'lucide:download' },
  { id: 'settings', label: t('common.settings'), icon: 'lucide:settings' },
]);

async function handleItemClick(itemId: string) {
  if (itemId === 'home') {
    if (isEditorPage.value) {
      await leaveProject('/m');
    } else {
      router.push('/m');
    }
    return;
  }

  const tabId = itemId as 'files' | 'edit' | 'export' | 'settings';

  if (isEditorPage.value) {
    if (props.activeTab === tabId && tabId === 'files') {
      fileManagerStore.selectedFolder = null;
    } else {
      emit('update:activeTab', tabId);
    }
  } else if (lastProjectName.value) {
    router.push({
      path: `/m/editor/${encodeURIComponent(lastProjectName.value)}`,
      query: { view: tabId },
    });
  }
}
</script>

<template>
  <nav
    v-if="showNav"
    class="shrink-0 border-t border-slate-800 bg-slate-950/95 pb-safe backdrop-blur"
  >
    <div class="grid h-16 grid-cols-5 items-center gap-1 px-1">
      <button
        v-for="item in navItems"
        :key="item.id"
        class="flex h-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center transition-colors outline-none"
        :class="
          activeTab === item.id || (item.id === 'home' && !isEditorPage)
            ? 'bg-selection-accent-500/12 text-selection-accent-400'
            : 'text-slate-400 active:bg-slate-900'
        "
        :aria-pressed="activeTab === item.id || (item.id === 'home' && !isEditorPage)"
        @click="handleItemClick(item.id)"
      >
        <Icon :name="item.icon" class="w-6 h-6 shrink-0" />
        <span class="text-[10px] font-medium truncate w-full px-0.5">{{ item.label }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0);
}
</style>
