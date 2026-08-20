<script setup lang="ts">
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useFileManagerStore } from '~/stores/file-manager.store';
import { useWorkspaceStore } from '~/stores/workspace.store';

type TabId = 'files' | 'edit' | 'export' | 'settings';

interface NavItem {
  id: 'home' | TabId;
  label: string;
  icon: string;
}

const props = withDefaults(
  defineProps<{
    activeTab?: TabId;
    /** Tabs offered, in order. A trimmed list drives the embed profile. */
    tabs?: TabId[];
    /**
     * `routed` is the standalone app: the bar also carries a home button and
     * navigates. `embedded` has nowhere to navigate to — the host owns
     * everything outside the editor — so it only switches tabs.
     */
    mode?: 'routed' | 'embedded';
  }>(),
  {
    activeTab: undefined,
    tabs: () => ['files', 'edit', 'export', 'settings'],
    mode: 'routed',
  },
);

const emit = defineEmits<{
  (e: 'update:activeTab', value: TabId): void;
}>();

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const workspaceStore = useWorkspaceStore();
const { leaveProject } = useProjectActions();
const fileManagerStore = useFileManagerStore();

const lastProjectName = computed(() => workspaceStore.lastProjectName);
const isEmbedded = computed(() => props.mode === 'embedded');
const isEditorPage = computed(() => isEmbedded.value || route.path.startsWith('/m/editor/'));

// Panels should be hidden on home if no last-project
const showNav = computed(() => {
  if (isEditorPage.value) return true;
  return !!lastProjectName.value;
});

const TAB_ITEMS: Record<TabId, { labelKey: string; icon: string }> = {
  files: { labelKey: 'common.files', icon: 'lucide:folder-open' },
  edit: { labelKey: 'common.edit', icon: 'lucide:clapperboard' },
  export: { labelKey: 'common.export', icon: 'lucide:download' },
  settings: { labelKey: 'common.settings', icon: 'lucide:settings' },
};

const navItems = computed<NavItem[]>(() => {
  const tabs = props.tabs.map((id) => ({
    id,
    label: t(TAB_ITEMS[id].labelKey),
    icon: TAB_ITEMS[id].icon,
  }));
  if (isEmbedded.value) return tabs;
  return [{ id: 'home' as const, label: t('common.toHome'), icon: 'lucide:home' }, ...tabs];
});

async function handleItemClick(itemId: NavItem['id']) {
  if (isEmbedded.value) {
    if (itemId !== 'home') emit('update:activeTab', itemId);
    return;
  }

  if (itemId === 'home') {
    if (isEditorPage.value) {
      await leaveProject('/m');
    } else {
      router.push('/m');
    }
    return;
  }

  if (isEditorPage.value) {
    if (props.activeTab === itemId && itemId === 'files') {
      fileManagerStore.selectedFolder = null;
    } else {
      emit('update:activeTab', itemId);
    }
  } else if (lastProjectName.value) {
    router.push({
      path: `/m/editor/${encodeURIComponent(lastProjectName.value)}`,
      query: { view: itemId },
    });
  }
}
</script>

<template>
  <nav
    v-if="showNav"
    class="shrink-0 border-t border-ui-border bg-ui-bg/95 pb-safe backdrop-blur landscape:border-t-0 landscape:border-r landscape:pb-0 landscape:pt-safe landscape:w-20 landscape:h-full"
  >
    <div
      class="grid h-16 items-center gap-1 px-1 landscape:flex landscape:flex-col landscape:h-full landscape:w-full landscape:py-6 landscape:gap-4 landscape:items-center landscape:justify-start"
      :style="{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }"
    >
      <button
        v-for="item in navItems"
        :key="item.id"
        class="flex h-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center transition-colors outline-none landscape:h-14 landscape:w-14 landscape:shrink-0"
        :class="
          activeTab === item.id || (item.id === 'home' && !isEditorPage)
            ? 'bg-selection-accent-500/12 text-selection-accent-400'
            : 'text-ui-text-muted active:bg-ui-bg-elevated'
        "
        :aria-pressed="activeTab === item.id || (item.id === 'home' && !isEditorPage)"
        @click="handleItemClick(item.id)"
      >
        <Icon :name="item.icon" class="w-6 h-6 shrink-0" />
      </button>
    </div>
  </nav>
</template>
