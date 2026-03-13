<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectManagement } from '~/composables/project/useProjectManagement';
import SearchInput from '~/components/ui/SearchInput.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();

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
} = useProjectManagement();

// Локальная копия последнего проекта для отображения "Continue Working"
// так как в родительском компоненте мы его удаляем из глобального стора
const suggestedProject = computed(() => workspaceStore.lastProjectName);
</script>

<template>
  <div class="flex flex-col flex-1 bg-ui-bg p-8 overflow-y-auto">
    <div class="max-w-5xl w-full mx-auto space-y-8 pb-12">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-ui-text">
            {{ t('granVideoEditor.projects.title') }}
          </h1>
          <p class="text-ui-text-muted text-sm mt-1">
            Workspace: {{ workspaceStore.workspaceHandle?.name }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton
            size="sm"
            variant="ghost"
            color="primary"
            icon="lucide:smartphone"
            to="/m"
            :label="t('granVideoEditor.projects.switchToMobile')"
          />
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-arrow-left-on-rectangle"
            :label="t('granVideoEditor.projects.changeWorkspace')"
            @click="workspaceStore.resetWorkspace"
          />
        </div>
      </div>

      <div v-if="workspaceStore.error" class="text-error-400 text-sm">
        {{ workspaceStore.error }}
      </div>

      <!-- Last Project Hero Section -->
      <div
        v-if="suggestedProject && workspaceStore.projects.includes(suggestedProject)"
        class="bg-linear-to-r from-primary-950/80 to-primary-900/40 border border-primary-500/30 rounded-2xl p-8 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl shadow-primary-500/10"
      >
        <div class="space-y-2">
          <span class="text-primary-400 text-xs font-bold uppercase tracking-widest">
            {{ t('granVideoEditor.projects.continueWorking') }}
          </span>
          <h2 class="text-3xl font-bold text-ui-text">{{ suggestedProject }}</h2>
        </div>
        <UButton
          size="xl"
          color="primary"
          class="px-8 shadow-lg shadow-primary-500/20"
          icon="i-heroicons-play"
          :label="t('granVideoEditor.projects.openLast')"
          @click="handleOpenProject(suggestedProject!)"
        />
      </div>

      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h3 class="font-medium text-ui-text-muted uppercase text-xs tracking-wider">
            {{ t('granVideoEditor.projects.recentProjects') }} ({{
              workspaceStore.projects.length
            }})
          </h3>
          <div class="w-64">
            <SearchInput
              v-model="searchQuery"
              :placeholder="t('granVideoEditor.projects.searchPlaceholder')"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          <!-- Create New Project Card -->
          <div
            class="bg-ui-bg-elevated border border-ui-border rounded-xl p-6 flex flex-col gap-4 shadow-xl"
          >
            <h3 class="font-medium text-ui-text">
              {{ t('granVideoEditor.projects.newProject') }}
            </h3>
            <UInput
              v-model="newProjectName"
              :placeholder="t('granVideoEditor.projects.projectNamePlaceholder')"
              @keyup.enter="createNewProject"
            />
            <UButton
              color="primary"
              variant="soft"
              class="justify-center mt-auto"
              :loading="workspaceStore.isLoading"
              :disabled="!newProjectName.trim()"
              :label="t('common.create')"
              @click="createNewProject"
            />
          </div>

          <!-- Existing Projects -->
          <div
            v-for="project in filteredProjects"
            :key="project"
            class="bg-ui-bg-elevated border border-ui-border rounded-xl p-6 flex flex-col hover:border-primary-500/50 hover:bg-ui-bg-accent transition-all cursor-pointer group shadow-lg"
            @click="isRenaming === project ? null : handleOpenProject(project)"
          >
            <div class="flex items-center justify-between gap-3 mb-4 overflow-hidden">
              <div class="flex items-center gap-3 overflow-hidden">
                <div
                  class="w-10 h-10 rounded-lg bg-ui-bg-accent flex items-center justify-center group-hover:bg-primary-500/10 transition-colors"
                >
                  <UIcon
                    name="i-heroicons-film"
                    class="w-5 h-5 text-ui-text-muted group-hover:text-primary-400 transition-colors"
                  />
                </div>
                <div v-if="isRenaming === project" class="flex-1">
                  <UInput
                    v-model="renameValue"
                    size="sm"
                    autofocus
                    @keyup.enter="renameProject(project)"
                    @keyup.esc="isRenaming = null"
                    @click.stop
                  />
                </div>
                <h3
                  v-else
                  class="font-medium text-ui-text truncate group-hover:text-primary-300 transition-colors"
                >
                  {{ project }}
                </h3>
              </div>
            </div>

            <div class="mt-auto flex justify-between items-center pt-4">
              <UButton
                v-if="isRenaming !== project"
                size="sm"
                variant="ghost"
                color="neutral"
                icon="lucide:edit-2"
                class="opacity-0 group-hover:opacity-100 transition-opacity"
                @click.stop="startRename(project)"
              />
              <div v-else class="flex gap-1 ml-auto">
                <UButton
                  size="xs"
                  color="neutral"
                  icon="lucide:x"
                  @click.stop="isRenaming = null"
                />
                <UButton
                  size="xs"
                  color="primary"
                  icon="lucide:check"
                  @click.stop="renameProject(project)"
                />
              </div>

              <UButton
                v-if="isRenaming !== project"
                size="sm"
                variant="ghost"
                color="primary"
                icon="i-heroicons-arrow-right"
                class="opacity-0 group-hover:opacity-100 transition-all translate-x-1 group-hover:translate-x-0 ml-auto"
                :label="t('common.open')"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
