<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useProjectManagement } from '~/composables/project/useProjectManagement';
import WelcomeScreen from '~/components/startup/WelcomeScreen.vue';

definePageMeta({
  layout: 'mobile',
});

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const { resetProjectState } = useProjectActions();

// Сбрасываем состояние открытого проекта при попадании на список
resetProjectState();

const {
  searchQuery,
  newProjectName,
  isRenaming,
  renameValue,
  filteredProjects,
  createNewProject,
  handleOpenProject,
  renameProject,
  startRename,
} = useProjectManagement({ isMobile: true });

// Локальная копия последнего проекта для отображения предложения
const suggestedProject = computed(() => workspaceStore.lastProjectName);
</script>

<template>
  <!-- Если рабочая область не выбрана -->
  <WelcomeScreen v-if="!workspaceStore.workspaceHandle" />

  <div v-else class="p-4 flex flex-col gap-6 bg-slate-950 min-h-screen">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold text-white">{{ t('granVideoEditor.projects.title') }}</h1>
      <div class="flex gap-1">
        <UButton
          size="sm"
          variant="ghost"
          color="neutral"
          icon="lucide:monitor"
          to="/?mode=desktop"
          :label="t('granVideoEditor.projects.switchToDesktop')"
        />
        <UButton
          size="sm"
          variant="ghost"
          color="neutral"
          icon="i-heroicons-arrow-left-on-rectangle"
          @click="workspaceStore.resetWorkspace"
        />
      </div>
    </div>

    <!-- Workspace Info -->
    <div
      v-if="workspaceStore.workspaceHandle"
      class="text-sm text-slate-400 -mt-4 flex items-center justify-between px-1"
    >
      <span class="truncate"
        >{{ t('granVideoEditor.projects.title') }}: {{ workspaceStore.workspaceHandle.name }}</span
      >
      <UButton size="xs" variant="link" color="primary" @click="workspaceStore.resetWorkspace">
        {{ t('granVideoEditor.projects.changeWorkspace') }}
      </UButton>
    </div>

    <!-- Last Project Suggestion -->
    <div
      v-if="suggestedProject && workspaceStore.projects.includes(suggestedProject)"
      class="bg-blue-600/20 border border-blue-500/30 rounded-xl p-5 flex flex-col gap-3 shadow-lg shadow-blue-500/5 animate-in fade-in slide-in-from-top-2 duration-500"
    >
      <div class="flex flex-col">
        <span class="text-blue-400 text-[10px] font-bold uppercase tracking-widest">{{
          t('granVideoEditor.projects.continueWorking')
        }}</span>
        <h2 class="text-xl font-bold text-white truncate">{{ suggestedProject }}</h2>
      </div>
      <UButton
        block
        color="primary"
        icon="lucide:play"
        @click="handleOpenProject(suggestedProject!)"
      >
        {{ t('granVideoEditor.projects.openLast') }}
      </UButton>
    </div>

    <!-- Create Project -->
    <div class="bg-slate-900 rounded-xl p-4 border border-slate-800 shadow-xl">
      <h3 class="font-medium mb-3 text-slate-300">
        {{ t('granVideoEditor.projects.newProject') }}
      </h3>
      <div class="flex gap-2">
        <UInput
          v-model="newProjectName"
          :placeholder="t('granVideoEditor.projects.projectNamePlaceholder')"
          class="flex-1"
          @keyup.enter="createNewProject"
        />
        <UButton
          color="primary"
          :loading="workspaceStore.isLoading"
          :disabled="!newProjectName.trim()"
          @click="createNewProject"
        >
          {{ t('common.create') }}
        </UButton>
      </div>
    </div>

    <div v-if="workspaceStore.error" class="text-red-400 text-sm">
      {{ workspaceStore.error }}
    </div>

    <!-- Project List -->
    <div class="space-y-4 flex-1 pb-10">
      <div class="flex items-center justify-between px-1">
        <h3 class="font-medium text-slate-400">
          {{ t('granVideoEditor.projects.recentProjects') }}
          <span
            class="text-xs font-normal tabular-nums bg-slate-800 px-2 py-0.5 rounded-full ml-1"
            >{{ workspaceStore.projects.length }}</span
          >
        </h3>
      </div>

      <!-- Search -->
      <SearchInput
        v-model="searchQuery"
        :placeholder="t('granVideoEditor.projects.searchPlaceholder')"
        class="mb-2"
      />

      <div v-if="filteredProjects.length > 0" class="grid grid-cols-1 gap-3">
        <div
          v-for="project in filteredProjects"
          :key="project"
          class="bg-slate-900/40 border border-slate-800 rounded-xl p-4 flex items-center justify-between active:bg-slate-800 active:scale-[0.98] transition-all shadow-sm"
          @click="isRenaming === project ? null : handleOpenProject(project)"
        >
          <div class="flex items-center gap-3 overflow-hidden flex-1">
            <div
              class="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center shrink-0"
            >
              <Icon name="lucide:film" class="w-5 h-5 text-blue-400" />
            </div>
            <div v-if="isRenaming === project" class="flex-1 flex gap-2">
              <UInput
                v-model="renameValue"
                size="sm"
                class="flex-1"
                autofocus
                @keyup.enter="renameProject(project)"
                @keyup.esc="isRenaming = null"
                @click.stop
              />
              <UButton
                size="xs"
                color="primary"
                icon="lucide:check"
                @click.stop="renameProject(project)"
              />
            </div>
            <span v-else class="font-medium text-slate-200 truncate">{{ project }}</span>
          </div>

          <div class="flex items-center gap-2">
            <UButton
              v-if="isRenaming !== project"
              size="sm"
              variant="ghost"
              color="neutral"
              icon="lucide:edit-2"
              @click.stop="startRename(project)"
            />
            <Icon
              v-if="isRenaming !== project"
              name="lucide:chevron-right"
              class="w-5 h-5 text-slate-600 shrink-0"
            />
          </div>
        </div>
      </div>

      <div v-else class="flex flex-col items-center justify-center py-16 text-slate-500 gap-4">
        <div class="w-20 h-20 rounded-full bg-slate-900 flex items-center justify-center">
          <Icon name="lucide:folder-open" class="w-10 h-10 opacity-20" />
        </div>
        <div class="text-center">
          <p class="font-medium">{{ t('granVideoEditor.projects.noProjectsFound') }}</p>
          <p class="text-sm opacity-60">{{ t('granVideoEditor.projects.newProject') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
