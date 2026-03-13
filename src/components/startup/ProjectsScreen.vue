<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectManagement } from '~/composables/project/useProjectManagement';
import SearchInput from '~/components/ui/SearchInput.vue';
import AppModal from '~/components/ui/AppModal.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const isAdvancedOpen = ref(false);

const {
  searchQuery,
  isRenaming,
  renameValue,
  isCreateModalOpen,
  projectCreationSettings,
  filteredProjects,
  createNewProject,
  startCreateProject,
  applyProjectCreationPreset,
  handleOpenProject,
  renameProject,
  startRename,
} = useProjectManagement();

const projectPresetOptions = computed(() =>
  workspaceStore.userSettings.projectPresets.items.map((preset) => ({
    value: preset.id,
    label: preset.name,
  })),
);

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
            class="bg-ui-bg-elevated border border-ui-border rounded-xl p-6 flex flex-col items-center justify-center gap-4 shadow-xl hover:border-primary-500/50 hover:bg-ui-bg-accent transition-all cursor-pointer group"
            @click="startCreateProject"
          >
            <div
              class="w-12 h-12 rounded-full bg-primary-500/10 flex items-center justify-center group-hover:bg-primary-500/20 transition-colors"
            >
              <UIcon name="i-heroicons-plus" class="w-6 h-6 text-primary-400" />
            </div>
            <h3 class="font-medium text-ui-text">
              {{ t('granVideoEditor.projects.newProject') }}
            </h3>
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

      <div v-if="!projectCreationSettings.isAdvancedSettingsOpen" class="text-xs text-ui-text-muted bg-ui-bg-accent p-3 rounded-lg flex gap-2">
        <UIcon name="i-heroicons-information-circle" class="w-4 h-4 shrink-0 text-primary-400" />
        {{ t('granVideoEditor.projects.autoDetectHint', 'Project resolution and framerate will be automatically detected from the first video added to the timeline.') }}
      </div>

      <UCollapsible v-model:open="projectCreationSettings.isAdvancedSettingsOpen">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          class="p-0 hover:bg-transparent"
          :icon="
            projectCreationSettings.isAdvancedSettingsOpen ? 'i-heroicons-chevron-down-20-solid' : 'i-heroicons-chevron-right-20-solid'
          "
          :label="t('videoEditor.projectSettings.advanced', 'Advanced Settings')"
        />

        <template #content>
          <div class="pt-4 border-t border-ui-border mt-2">
            <UFormField :label="t('videoEditor.export.presetLabel', 'Preset')" class="mb-4">
              <USelectMenu
                v-model="projectCreationSettings.presetId"
                :items="projectPresetOptions"
                value-key="value"
                label-key="label"
                class="w-full"
                @update:model-value="(value: string) => applyProjectCreationPreset(value)"
              />
            </UFormField>

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
