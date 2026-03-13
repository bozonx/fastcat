<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useProjectManagement } from '~/composables/project/useProjectManagement';
import WelcomeScreen from '~/components/startup/WelcomeScreen.vue';
import AppModal from '~/components/ui/AppModal.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';

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
  isRenaming,
  renameValue,
  isCreateModalOpen,
  projectCreationSettings,
  filteredProjects,
  createNewProject,
  startCreateProject,
  handleOpenProject,
  renameProject,
  startRename,
} = useProjectManagement({ isMobile: true });

const isAdvancedOpen = ref(false);

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
    <div
      class="bg-slate-900 rounded-xl p-5 border border-slate-800 shadow-xl flex items-center justify-between active:bg-slate-800 transition-colors"
      @click="startCreateProject"
    >
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-primary-500/10 flex items-center justify-center">
          <UIcon name="i-heroicons-plus" class="w-5 h-5 text-primary-400" />
        </div>
        <h3 class="font-medium text-slate-200">
          {{ t('granVideoEditor.projects.newProject') }}
        </h3>
      </div>
      <UIcon name="i-heroicons-chevron-right" class="w-5 h-5 text-slate-600" />
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

  <AppModal
    v-model:open="isCreateModalOpen"
    :title="t('granVideoEditor.projects.newProject')"
    :ui="{ content: 'sm:max-w-lg max-h-[90vh]', body: 'overflow-y-auto' }"
  >
    <div class="space-y-6">
      <div class="space-y-2">
        <label class="text-sm font-medium text-ui-text">
          {{ t('granVideoEditor.projects.projectNamePlaceholder') }}
        </label>
        <UInput
          v-model="projectCreationSettings.name"
          :placeholder="t('granVideoEditor.projects.projectNamePlaceholder')"
          autofocus
          @keyup.enter="createNewProject"
        />
      </div>

      <UCollapsible>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          class="p-0 hover:bg-transparent"
          :icon="
            isAdvancedOpen ? 'i-heroicons-chevron-down-20-solid' : 'i-heroicons-chevron-right-20-solid'
          "
          :label="t('videoEditor.projectSettings.advanced', 'Advanced Settings')"
          @click="isAdvancedOpen = !isAdvancedOpen"
        />

        <template #content>
          <div class="pt-4 border-t border-ui-border mt-2">
            <MediaResolutionSettings
              v-model:width="projectCreationSettings.width"
              v-model:height="projectCreationSettings.height"
              v-model:fps="projectCreationSettings.fps"
              v-model:resolution-format="projectCreationSettings.resolutionFormat"
              v-model:orientation="projectCreationSettings.orientation"
              v-model:aspect-ratio="projectCreationSettings.aspectRatio"
              v-model:is-custom-resolution="projectCreationSettings.isCustomResolution"
              v-model:sample-rate="projectCreationSettings.sampleRate"
            />
          </div>
        </template>
      </UCollapsible>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3 w-full">
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('common.cancel')"
          @click="isCreateModalOpen = false"
        />
        <UButton
          color="primary"
          :disabled="!projectCreationSettings.name.trim()"
          :loading="workspaceStore.isLoading"
          :label="t('common.create')"
          @click="createNewProject"
        />
      </div>
    </template>
  </AppModal>
</template>
