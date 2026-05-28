<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectManagement } from '~/composables/project/useProjectManagement';
import UiSearchInput from '~/components/ui/UiSearchInput.vue';
import UiModal from '~/components/ui/UiModal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';

import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import ProjectThumbnail from '~/components/startup/ProjectThumbnail.vue';
import EditorSettingsModal from '~/components/settings/EditorSettingsModal.vue';

const { t, locale } = useI18n();
const workspaceStore = useWorkspaceStore();
const isSettingsOpen = ref(false);
const canChangeWorkspace = computed(() => workspaceStore.workspaceProviderId !== 'tauri');

const {
  searchQuery,
  renameValue,
  isCreateModalOpen,
  projectCreationSettings,
  filteredProjects,
  isRenameModalOpen,
  isDeleteModalOpen,
  createNewProject,
  startCreateProject,
  applyProjectCreationPreset,
  handleOpenProject,
  renameProject,
  startRename,
  startDelete,
  confirmDelete,
  closeDeleteModal,
} = useProjectManagement();

const projectPresetOptions = computed(() =>
  workspaceStore.userSettings.projectPresets.items.map((preset: { id: string; name: string }) => ({
    value: preset.id,
    label: preset.name,
  })),
);

type SortBy = 'date' | 'name';
type SortOrder = 'asc' | 'desc';

const sortBy = ref<SortBy>('date');
const sortOrder = ref<SortOrder>('desc');

const allProjects = computed(() => {
  const recentMap = new Map(workspaceStore.recentProjects.map((p) => [p.projectName, p]));
  return filteredProjects.value.map((name) => {
    const recent = recentMap.get(name);
    return {
      projectName: name,
      projectId: recent?.projectId,
      lastTimelinePath: recent?.lastTimelinePath,
      updatedAt: recent?.updatedAt,
    };
  });
});

const sortedProjects = computed(() => {
  const projects = [...allProjects.value];
  const multiplier = sortOrder.value === 'asc' ? 1 : -1;

  if (sortBy.value === 'name') {
    projects.sort((a, b) => multiplier * a.projectName.localeCompare(b.projectName));
  } else {
    projects.sort((a, b) => {
      const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      if (dateA === dateB) {
        return multiplier * a.projectName.localeCompare(b.projectName);
      }
      return multiplier * (dateA - dateB);
    });
  }

  return projects;
});

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat(locale.value, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};
</script>

<template>
  <div class="flex h-screen bg-ui-bg overflow-hidden">
    <!-- Sidebar -->
    <div
      class="w-80 border-r border-ui-border bg-ui-bg-elevated/50 flex flex-col shrink-0 backdrop-blur-md"
    >
      <!-- Logo -->
      <div class="p-6 border-b border-ui-border">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl bg-primary-500 flex items-center justify-center shadow-lg shadow-primary-500/20"
          >
            <UIcon name="lucide:cat" class="w-6 h-6 text-white" />
          </div>
          <div class="overflow-hidden">
            <h1 class="font-bold text-lg text-ui-text leading-tight tracking-tight">FASTCAT</h1>
            <p class="text-[10px] text-ui-text-muted uppercase tracking-widest font-semibold">
              Video Editor
            </p>
          </div>
        </div>
      </div>

      <!-- Primary Action -->
      <div class="p-4 space-y-4">
        <UButton
          block
          size="xl"
          color="primary"
          icon="i-heroicons-plus"
          class="shadow-lg shadow-ui-action/20 py-4 rounded-2xl font-bold uppercase tracking-wide bg-ui-action! hover:bg-ui-action-hover! text-white! border-none transition-all hover:scale-[1.02] active:scale-[0.98]"
          @click="startCreateProject"
        >
          {{ t('fastcat.projects.newProject') }}
        </UButton>
      </div>

      <!-- Bottom Actions -->
      <div class="mt-auto p-4 border-t border-ui-border space-y-4">
        <!-- Workspace Info -->
        <div class="space-y-2">
          <span class="text-[10px] font-bold text-ui-text-muted uppercase tracking-wider block">
            {{ t('fastcat.projects.workspaceTitle') }}
          </span>
          <p class="text-xs font-medium text-ui-text truncate">
            {{ workspaceStore.workspaceHandle?.name }}
          </p>
        </div>

        <div class="space-y-1">
          <UButton
            v-if="canChangeWorkspace"
            block
            variant="ghost"
            color="primary"
            icon="i-heroicons-folder-open"
            :label="t('fastcat.projects.changeWorkspace')"
            class="justify-start px-3"
            @click="workspaceStore.resetWorkspace"
          />
          <UButton
            block
            variant="ghost"
            color="neutral"
            icon="i-heroicons-cog-6-tooth"
            :label="t('videoEditor.settings.title')"
            class="justify-start px-3"
            @click="isSettingsOpen = true"
          />
          <UButton
            block
            variant="ghost"
            color="primary"
            icon="lucide:smartphone"
            to="/m"
            :label="t('fastcat.projects.switchToMobile')"
            class="justify-start px-3"
          />
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden relative">
      <!-- Top Bar -->
      <header
        class="h-16 border-b border-ui-border bg-ui-bg/80 backdrop-blur-sm flex items-center justify-between px-8 z-10 shrink-0"
      >
        <div class="flex items-center gap-4 flex-1 max-w-xl">
          <UiSearchInput
            v-model="searchQuery"
            :placeholder="t('fastcat.projects.searchPlaceholder')"
            class="w-full"
          />
        </div>

        <div class="flex items-center gap-4">
          <div v-if="workspaceStore.error" class="text-error-400 text-xs font-medium">
            {{ workspaceStore.error }}
          </div>
        </div>
      </header>

      <!-- Content Area -->
      <div class="flex-1 overflow-y-auto custom-scrollbar">
        <div class="max-w-7xl mx-auto p-8 space-y-12">
          <!-- Projects Grid -->
          <section>
            <div class="flex items-center justify-between mb-6">
              <h2 class="text-lg font-bold text-ui-text flex items-center gap-2">
                <UIcon name="lucide:box" class="text-primary-400" />
                {{ t('fastcat.projects.title') }}
                <span class="text-ui-text-muted font-normal text-sm ml-2"
                  >({{ sortedProjects.length }})</span
                >
              </h2>

              <div class="flex items-center gap-1">
                <UTooltip :text="t('common.updated')">
                  <UButton
                    variant="ghost"
                    size="xs"
                    color="neutral"
                    :class="{ 'bg-ui-bg-elevated text-primary-400': sortBy === 'date' }"
                    icon="i-heroicons-calendar"
                    @click="sortBy = 'date'"
                  />
                </UTooltip>
                <UTooltip :text="t('common.name')">
                  <UButton
                    variant="ghost"
                    size="xs"
                    color="neutral"
                    :class="{ 'bg-ui-bg-elevated text-primary-400': sortBy === 'name' }"
                    icon="i-heroicons-bars-3-bottom-left"
                    @click="sortBy = 'name'"
                  />
                </UTooltip>
                <div class="w-px h-4 bg-ui-border mx-1" />
                <UTooltip
                  :text="
                    sortOrder === 'asc' ? t('common.sortOrder.asc') : t('common.sortOrder.desc')
                  "
                >
                  <UButton
                    variant="ghost"
                    size="xs"
                    color="neutral"
                    :icon="sortOrder === 'asc' ? 'i-heroicons-arrow-up' : 'i-heroicons-arrow-down'"
                    @click="sortOrder = sortOrder === 'asc' ? 'desc' : 'asc'"
                  />
                </UTooltip>
              </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              <!-- Projects -->
              <div
                v-for="project in sortedProjects"
                :key="project.projectName"
                class="flex flex-col group bg-ui-bg-elevated/50 border border-ui-border rounded-xl overflow-hidden hover:border-primary-500/50 hover:bg-ui-bg-accent transition-all cursor-pointer"
                @click="handleOpenProject(project.projectName)"
              >
                <div class="aspect-video relative shrink-0">
                  <ProjectThumbnail
                    :project-id="project.projectId"
                    :project-relative-path="project.lastTimelinePath"
                    :project-name="project.projectName"
                  />
                </div>

                <div class="p-3 flex flex-col flex-1 min-h-[74px]">
                  <h3
                    class="text-sm font-semibold text-ui-text truncate group-hover:text-primary-400 transition-colors mb-1"
                  >
                    {{ project.projectName }}
                  </h3>

                  <div
                    class="flex items-center justify-between mt-auto pt-2 border-t border-ui-border/50 h-8"
                  >
                    <span class="text-[10px] text-ui-text-muted font-medium truncate">
                      {{ project.updatedAt ? formatDate(project.updatedAt) : '' }}
                    </span>
                    <UDropdownMenu
                      :items="[
                        [
                          {
                            label: t('common.rename'),
                            icon: 'i-heroicons-pencil-square',
                            onSelect: () => startRename(project.projectName),
                          },
                          {
                            label: t('common.delete'),
                            icon: 'i-heroicons-trash',
                            onSelect: () => startDelete(project.projectName),
                          },
                        ],
                      ]"
                    >
                      <UButton
                        size="xs"
                        variant="ghost"
                        color="neutral"
                        icon="i-heroicons-ellipsis-vertical"
                        class="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        @click.stop
                      />
                    </UDropdownMenu>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>

  <!-- Create Project Modal -->
  <UiModal
    v-model:open="isCreateModalOpen"
    :title="t('fastcat.projects.newProject')"
    :ui="{ content: 'sm:max-w-lg max-h-[90vh]', body: 'overflow-y-auto' }"
  >
    <div class="space-y-6">
      <UiFormField :label="t('fastcat.projects.projectNamePlaceholder')">
        <UiTextInput
          v-model="projectCreationSettings.name"
          :placeholder="t('fastcat.projects.projectNamePlaceholder')"
          autofocus
          @keyup.enter="createNewProject"
        />
      </UiFormField>

      <div
        v-if="!projectCreationSettings.isAdvancedSettingsOpen"
        class="text-xs text-ui-text-muted bg-ui-bg-accent p-3 rounded-lg flex gap-2 border border-ui-border"
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
          :label="t('videoEditor.projectSettings.advanced')"
        />

        <template #content>
          <div class="pt-4 border-t border-ui-border mt-2">
            <UiFormField :label="t('videoEditor.export.presetLabel')" class="mb-4">
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
            </UiFormField>

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

  <!-- Rename Project Modal -->
  <UiModal
    v-model:open="isRenameModalOpen"
    :title="t('common.rename')"
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <UiFormField :label="t('fastcat.projects.projectNamePlaceholder')">
      <UiTextInput
        v-model="renameValue"
        :placeholder="t('fastcat.projects.projectNamePlaceholder')"
        autofocus
        @keyup.enter="renameProject"
      />
    </UiFormField>

    <template #footer>
      <div class="flex justify-end gap-3 w-full">
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('common.cancel')"
          @click="isRenameModalOpen = false"
        />
        <UButton
          color="primary"
          :disabled="!renameValue.trim()"
          :label="t('common.rename')"
          @click="renameProject"
        />
      </div>
    </template>
  </UiModal>

  <!-- Delete Project Confirmation Modal -->
  <UiModal
    v-model:open="isDeleteModalOpen"
    :title="t('videoEditor.projectSettings.deleteProjectConfirmTitle')"
    :description="t('videoEditor.projectSettings.deleteProjectConfirmDescription')"
    :ui="{ content: 'sm:max-w-md' }"
  >
    <template #footer>
      <div class="flex justify-end gap-3 w-full">
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('common.cancel')"
          @click="closeDeleteModal"
        />
        <UButton
          color="error"
          :label="t('videoEditor.projectSettings.deleteProjectAction')"
          :loading="workspaceStore.isLoading"
          @click="confirmDelete"
        />
      </div>
    </template>
  </UiModal>

  <EditorSettingsModal v-model:open="isSettingsOpen" />
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--ui-border);
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: var(--ui-text-muted);
}
</style>
