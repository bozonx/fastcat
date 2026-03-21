<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectManagement } from '~/composables/project/useProjectManagement';
import UiSearchInput from '~/components/ui/UiSearchInput.vue';
import UiModal from '~/components/ui/UiModal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import ProjectThumbnail from '~/components/startup/ProjectThumbnail.vue';
import EditorSettingsModal from '~/components/settings/EditorSettingsModal.vue';

const { t } = useI18n();
const workspaceStore = useWorkspaceStore();
const isAdvancedOpen = ref(false);
const isSettingsOpen = ref(false);

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

// Список последних проектов для Hero-секции и списка
const recentProjects = computed(() => workspaceStore.recentProjects);

const getRecentInfo = (name: string) => recentProjects.value.find((p) => p.projectName === name);

// Умная сортировка: сначала недавние (по дате), потом остальные (по алфавиту)
const smartSortedProjects = computed(() => {
  const recentNames = recentProjects.value.map((p) => p.projectName);
  const others = filteredProjects.value
    .filter((p) => !recentNames.includes(p))
    .sort((a, b) => a.localeCompare(b));

  return [
    ...recentProjects.value.filter((p) => filteredProjects.value.includes(p.projectName)),
    ...others.map((p) => ({ projectName: p, projectId: undefined, lastTimelinePath: undefined })),
  ];
});
</script>

<template>
  <div class="flex flex-col flex-1 bg-ui-bg p-8 overflow-y-auto">
    <div class="max-w-5xl w-full mx-auto space-y-8 pb-12">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-ui-text">
            {{ t('fastcat.projects.title') }}
          </h1>
          <p class="text-ui-text-muted text-sm mt-1">
            Workspace: {{ workspaceStore.workspaceHandle?.name }}
          </p>
        </div>
        <div class="flex gap-2">
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-cog-6-tooth"
            :label="t('videoEditor.settings.title', 'Settings')"
            @click="isSettingsOpen = true"
          />
          <UButton
            size="sm"
            variant="ghost"
            color="primary"
            icon="lucide:smartphone"
            to="/m"
            :label="t('fastcat.projects.switchToMobile')"
          />
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            icon="i-heroicons-arrow-left-on-rectangle"
            :label="t('fastcat.projects.changeWorkspace')"
            @click="workspaceStore.resetWorkspace"
          />
        </div>
      </div>

      <div v-if="workspaceStore.error" class="text-error-400 text-sm">
        {{ workspaceStore.error }}
      </div>

      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between">
          <h3 class="font-medium text-ui-text-muted uppercase text-xs tracking-wider">
            {{ t('fastcat.projects.title') }} ({{ workspaceStore.projects.length }})
          </h3>
          <div class="w-64">
            <UiSearchInput
              v-model="searchQuery"
              :placeholder="t('fastcat.projects.searchPlaceholder')"
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
              {{ t('fastcat.projects.newProject') }}
            </h3>
          </div>

          <!-- Existing Projects -->
          <div
            v-for="project in smartSortedProjects"
            :key="project.projectName"
            class="bg-ui-bg-elevated border border-ui-border rounded-xl flex flex-col hover:border-primary-500/50 hover:bg-ui-bg-accent transition-all cursor-pointer group shadow-lg overflow-hidden"
            @click="
              isRenaming === project.projectName ? null : handleOpenProject(project.projectName)
            "
          >
            <div class="aspect-video relative shrink-0">
              <ProjectThumbnail
                :project-id="project.projectId"
                :project-relative-path="project.lastTimelinePath"
                :project-name="project.projectName"
              />
            </div>

            <div class="p-4 flex flex-col flex-1">
              <div class="flex items-center justify-between gap-3 mb-4 overflow-hidden">
                <div class="flex items-center gap-3 overflow-hidden">
                  <div
                    class="w-8 h-8 rounded-lg bg-ui-bg-accent flex items-center justify-center group-hover:bg-primary-500/10 transition-colors"
                  >
                    <UIcon
                      name="i-heroicons-film"
                      class="w-4 h-4 text-ui-text-muted group-hover:text-primary-400 transition-colors"
                    />
                  </div>
                  <div v-if="isRenaming === project.projectName" class="flex-1">
                    <UInput
                      v-model="renameValue"
                      size="sm"
                      autofocus
                      @keyup.enter="renameProject(project.projectName)"
                      @keyup.esc="isRenaming = null"
                      @click.stop
                    />
                  </div>
                  <h3
                    v-else
                    class="font-medium text-ui-text truncate group-hover:text-primary-300 transition-colors"
                  >
                    {{ project.projectName }}
                  </h3>
                </div>
              </div>

              <div class="mt-auto flex justify-between items-center pt-4">
                <UButton
                  v-if="isRenaming !== project.projectName"
                  size="sm"
                  variant="ghost"
                  color="neutral"
                  icon="lucide:edit-2"
                  class="opacity-0 group-hover:opacity-100 transition-opacity"
                  @click.stop="startRename(project.projectName)"
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
                    @click.stop="renameProject(project.projectName)"
                  />
                </div>

                <UButton
                  v-if="isRenaming !== project.projectName"
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
  </div>

  <UiModal
    v-model:open="isCreateModalOpen"
    :title="t('fastcat.projects.newProject')"
    :ui="{ content: 'sm:max-w-lg max-h-[90vh]', body: 'overflow-y-auto' }"
  >
    <div class="space-y-6">
      <div class="space-y-2">
        <label class="text-sm font-medium text-ui-text">
          {{ t('fastcat.projects.projectNamePlaceholder') }}
        </label>
        <UInput
          v-model="projectCreationSettings.name"
          :placeholder="t('fastcat.projects.projectNamePlaceholder')"
          autofocus
          @keyup.enter="createNewProject"
        />
      </div>

      <div
        v-if="!projectCreationSettings.isAdvancedSettingsOpen"
        class="text-xs text-ui-text-muted bg-ui-bg-accent p-3 rounded-lg flex gap-2"
      >
        <UIcon name="i-heroicons-information-circle" class="w-4 h-4 shrink-0 text-primary-400" />
        {{
          t(
            'fastcat.projects.autoDetectHint',
            'Project resolution and framerate will be automatically detected from the first video added to the timeline.',
          )
        }}
      </div>

      <UCollapsible v-model:open="projectCreationSettings.isAdvancedSettingsOpen">
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          class="p-0 hover:bg-transparent"
          :icon="
            projectCreationSettings.isAdvancedSettingsOpen
              ? 'i-heroicons-chevron-down-20-solid'
              : 'i-heroicons-chevron-right-20-solid'
          "
          :label="t('videoEditor.projectSettings.advanced', 'Advanced Settings')"
        />

        <template #content>
          <div class="pt-4 border-t border-ui-border mt-2">
            <UFormField :label="t('videoEditor.export.presetLabel', 'Preset')" class="mb-4">
              <UiSelect
                v-model="projectCreationSettings.presetId"
                :items="projectPresetOptions"
                value-key="value"
                label-key="label"
                full-width
                @update:model-value="
                  (value: unknown) =>
                    applyProjectCreationPreset(
                      (value as { value: string })?.value ?? (value as string),
                    )
                "
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
  </UiModal>

  <EditorSettingsModal v-model:open="isSettingsOpen" />
</template>
