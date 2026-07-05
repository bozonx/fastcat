<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import {
  useProjectManagement,
  type ProjectActionTarget,
} from '~/composables/project/useProjectManagement';
import UiSearchInput from '~/components/ui/UiSearchInput.vue';
import UiTooltip from '~/components/ui/UiTooltip.vue';
import UiModal from '~/components/ui/UiModal.vue';
import UiTextInput from '~/components/ui/UiTextInput.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import FriendlyTime from '~/components/ui/FriendlyTime.vue';

import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import ProjectThumbnail from '~/components/startup/ProjectThumbnail.vue';
import EditorSettingsModal from '~/components/settings/EditorSettingsModal.vue';
import { dropdownNoReturnFocus } from '~/composables/useDropdownMenuFocus';

const { t, locale: _locale } = useI18n();
const workspaceStore = useWorkspaceStore();
const isSettingsOpen = ref(false);

const {
  searchQuery,
  renameValue,
  isCreateModalOpen,
  isTransitioning,
  projectCreationSettings,
  filteredProjects,
  isRenameModalOpen,
  isDeleteModalOpen,
  isForgetModalOpen,
  forgetTargetProject,
  isDuplicateModalOpen,
  duplicateValue,
  duplicateLocation,
  createError,
  isCreateNameValid,
  renameError,
  isRenameNameValid,
  duplicateError,
  isDuplicateNameValid,
  createNewProject,
  startCreateProject,
  handleOpenProject,
  renameProject,
  startRename,
  startDelete,
  confirmDelete,
  closeDeleteModal,
  startForget,
  confirmForget,
  closeForgetModal,
  isExternalProject,
  startDuplicate,
  confirmDuplicate,
  closeDuplicateModal,
  selectProjectLocation,
  selectDuplicateLocation,
  openProjectFromDisk,
} = useProjectManagement();

const getProjectMenuItems = (project: ProjectActionTarget) => {
  const items = [
    {
      label: t('common.rename'),
      icon: 'i-heroicons-pencil-square',
      onSelect: () => startRename(project),
    },
    {
      label: t('common.duplicate'),
      icon: 'i-heroicons-document-duplicate',
      onSelect: () => startDuplicate(project),
    },
  ];

  if (workspaceStore.workspaceProviderId === 'tauri') {
    if (isExternalProject(project.projectPath)) {
      // External projects: only remove from the recent list.
      items.push({
        label: t('fastcat.projects.removeFromList'),
        icon: 'i-heroicons-minus-circle',
        onSelect: () => startForget(project),
      });
    } else {
      // Standard-folder projects: physically delete from disk.
      items.push({
        label: t('common.delete'),
        icon: 'i-heroicons-trash',
        onSelect: () => startDelete(project),
      });
    }
  } else {
    items.push({
      label: t('common.delete'),
      icon: 'i-heroicons-trash',
      onSelect: () => startDelete(project),
    });
  }

  return [items];
};

type SortBy = 'date' | 'name';
type SortOrder = 'asc' | 'desc';

const sortBy = ref<SortBy>('date');
const sortOrder = ref<SortOrder>('desc');

const allProjects = computed(() => {
  if (workspaceStore.workspaceProviderId === 'tauri') {
    const query = searchQuery.value.trim().toLowerCase();
    return workspaceStore.recentProjects
      .filter((project) => !query || project.projectName.toLowerCase().includes(query))
      .map((project) => ({
        projectName: project.projectName,
        projectId: project.projectId,
        lastTimelinePath: project.lastTimelinePath,
        updatedAt: project.updatedAt,
        projectPath: project.projectPath,
      }));
  }

  const recentMap = new Map(workspaceStore.recentProjects.map((p) => [p.projectName, p]));
  return filteredProjects.value.map((name) => {
    const recent = recentMap.get(name);
    return {
      projectName: name,
      projectId: recent?.projectId,
      lastTimelinePath: recent?.lastTimelinePath,
      updatedAt: recent?.updatedAt,
      projectPath: recent?.projectPath,
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

function getProjectOpenTarget(project: ProjectActionTarget): string {
  if (workspaceStore.workspaceProviderId === 'tauri') {
    return project.projectPath || project.projectName;
  }

  return project.projectName;
}

// formatDate removed in favor of FriendlyTime component
</script>

<template>
  <div class="flex h-screen bg-ui-bg overflow-hidden relative">
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
      <div class="p-4 space-y-3">
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
        <UButton
          v-if="workspaceStore.workspaceProviderId === 'tauri'"
          block
          size="lg"
          variant="subtle"
          color="neutral"
          icon="i-heroicons-folder-open"
          class="py-3 rounded-2xl font-bold uppercase tracking-wide transition-all hover:scale-[1.02] active:scale-[0.98]"
          @click="openProjectFromDisk"
        >
          {{ t('fastcat.projects.openProjectDisk') }}
        </UButton>
      </div>

      <!-- Bottom Actions -->
      <div class="mt-auto p-4 border-t border-ui-border space-y-4">
        <div class="space-y-1">
          <UButton
            block
            variant="ghost"
            color="neutral"
            icon="i-heroicons-cog-6-tooth"
            :label="t('videoEditor.settings.title')"
            class="justify-start px-3"
            @click="void (isSettingsOpen = true)"
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
                <UiTooltip :text="t('fastcat.projects.sortByDate')">
                  <UButton
                    variant="ghost"
                    size="xs"
                    color="neutral"
                    :class="{ 'bg-ui-bg-elevated text-primary-400': sortBy === 'date' }"
                    icon="i-heroicons-calendar"
                    @click="void (sortBy = 'date')"
                  />
                </UiTooltip>
                <UiTooltip :text="t('fastcat.projects.sortByName')">
                  <UButton
                    variant="ghost"
                    size="xs"
                    color="neutral"
                    :class="{ 'bg-ui-bg-elevated text-primary-400': sortBy === 'name' }"
                    icon="i-heroicons-bars-3-bottom-left"
                    @click="void (sortBy = 'name')"
                  />
                </UiTooltip>
                <div class="w-px h-4 bg-ui-border mx-1" />
                <UiTooltip
                  :text="
                    sortOrder === 'asc' ? t('common.sortOrder.asc') : t('common.sortOrder.desc')
                  "
                >
                  <UButton
                    variant="ghost"
                    size="xs"
                    color="neutral"
                    :icon="sortOrder === 'asc' ? 'i-heroicons-arrow-up' : 'i-heroicons-arrow-down'"
                    @click="void (sortOrder = sortOrder === 'asc' ? 'desc' : 'asc')"
                  />
                </UiTooltip>
              </div>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              <!-- Projects -->
              <div
                v-for="project in sortedProjects"
                :key="project.projectPath || project.projectId || project.projectName"
                class="flex flex-col group bg-ui-bg-elevated/50 border border-ui-border rounded-xl overflow-hidden hover:border-primary-500/50 hover:bg-ui-bg-accent transition-all cursor-pointer"
                @click="handleOpenProject(getProjectOpenTarget(project))"
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
                    :title="project.projectName"
                  >
                    {{ project.projectName }}
                  </h3>

                  <div
                    class="flex items-center justify-between mt-auto pt-2 border-t border-ui-border/50 h-8"
                  >
                    <span class="text-[10px] text-ui-text-muted font-medium truncate">
                      <FriendlyTime :date="project.updatedAt" fallback="" />
                    </span>
                    <UDropdownMenu
                      :items="getProjectMenuItems(project)"
                      :content="dropdownNoReturnFocus"
                    >
                      <UButton
                        size="xs"
                        variant="ghost"
                        color="neutral"
                        icon="i-heroicons-ellipsis-vertical-16-solid"
                        square
                        class="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
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
    :prevent-close="workspaceStore.isLoading"
    :close-button="!workspaceStore.isLoading"
  >
    <div class="space-y-6">
      <UiFormField
        :label="t('fastcat.projects.projectNamePlaceholder')"
        :error="createError ? t(createError) : undefined"
      >
        <UiTextInput
          v-model="projectCreationSettings.name"
          :placeholder="t('fastcat.projects.projectNamePlaceholder')"
          :disabled="workspaceStore.isLoading"
          full-width
          autofocus
          @keyup.enter="createNewProject"
        />
      </UiFormField>

      <UiFormField
        v-if="workspaceStore.workspaceProviderId === 'tauri'"
        :label="t('fastcat.projects.projectLocation')"
      >
        <div class="flex gap-2 w-full">
          <UiTextInput
            v-model="projectCreationSettings.location"
            readonly
            :disabled="workspaceStore.isLoading"
            full-width
            class="flex-1"
          />
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-heroicons-folder-open"
            :disabled="workspaceStore.isLoading"
            @click="selectProjectLocation"
          />
        </div>
      </UiFormField>

      <div class="flex items-center justify-between gap-3">
        <span class="text-sm text-ui-text">
          {{ t('fastcat.projects.specifyProjectSettings') }}
        </span>
        <USwitch
          v-model="projectCreationSettings.specifyProjectSettings"
          :disabled="workspaceStore.isLoading"
        />
      </div>

      <div
        v-if="!projectCreationSettings.specifyProjectSettings"
        class="text-xs text-ui-text-muted bg-ui-bg-accent p-3 rounded-lg flex gap-2 border border-ui-border"
      >
        <UIcon name="i-heroicons-information-circle" class="w-4 h-4 shrink-0 text-primary-400" />
        {{ t('fastcat.projects.autoDetectHint') }}
      </div>

      <div v-else class="pt-4 border-t border-ui-border mt-2">
        <MediaResolutionSettings
          v-model:width="projectCreationSettings.width"
          v-model:height="projectCreationSettings.height"
          v-model:fps="projectCreationSettings.fps"
          v-model:resolution-format="projectCreationSettings.resolutionFormat"
          v-model:orientation="projectCreationSettings.orientation"
          v-model:aspect-ratio="projectCreationSettings.aspectRatio"
          v-model:is-custom-resolution="projectCreationSettings.isCustomResolution"
          v-model:sample-rate="projectCreationSettings.sampleRate"
          :disabled="workspaceStore.isLoading"
        />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3 w-full">
        <UButton
          variant="ghost"
          color="neutral"
          :disabled="workspaceStore.isLoading"
          :label="t('common.cancel')"
          @click="void (isCreateModalOpen = false)"
        />
        <UButton
          color="primary"
          variant="solid"
          :disabled="!isCreateNameValid"
          :label="t('common.create')"
          @click="createNewProject"
        />
      </div>
    </template>
  </UiModal>

  <!-- Forget Project Confirmation Modal -->
  <UiModal
    v-model:open="isForgetModalOpen"
    :title="t('fastcat.projects.forgetProjectTitle')"
    :description="
      t('fastcat.projects.forgetProjectConfirm', { name: forgetTargetProject?.projectName })
    "
    :ui="{ content: 'sm:max-w-md' }"
  >
    <template #footer>
      <div class="flex justify-end gap-3 w-full">
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('common.cancel')"
          @click="closeForgetModal"
        />
        <UButton
          color="error"
          :label="t('fastcat.projects.removeFromList')"
          :loading="workspaceStore.isLoading"
          data-primary-focus="true"
          @click="confirmForget"
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
    <UiFormField
      :label="t('fastcat.projects.projectNamePlaceholder')"
      :error="renameError ? t(renameError) : undefined"
    >
      <UiTextInput
        v-model="renameValue"
        :placeholder="t('fastcat.projects.projectNamePlaceholder')"
        full-width
        autofocus
        select-on-focus
        @keyup.enter="renameProject"
      />
    </UiFormField>

    <template #footer>
      <div class="flex justify-end gap-3 w-full">
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('common.cancel')"
          @click="void (isRenameModalOpen = false)"
        />
        <UButton
          color="primary"
          variant="solid"
          :disabled="!isRenameNameValid"
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
          variant="solid"
          :label="t('videoEditor.projectSettings.deleteProjectAction')"
          :loading="workspaceStore.isLoading"
          data-primary-focus="true"
          @click="confirmDelete"
        />
      </div>
    </template>
  </UiModal>

  <!-- Duplicate Project Modal -->
  <UiModal
    v-model:open="isDuplicateModalOpen"
    :title="t('common.duplicate')"
    :ui="{ content: 'sm:max-w-lg' }"
  >
    <div class="space-y-6">
      <UiFormField
        :label="t('fastcat.projects.projectNamePlaceholder')"
        :error="duplicateError ? t(duplicateError) : undefined"
      >
        <UiTextInput
          v-model="duplicateValue"
          :placeholder="t('fastcat.projects.projectNamePlaceholder')"
          full-width
          autofocus
          select-on-focus
          @keyup.enter="confirmDuplicate"
        />
      </UiFormField>

      <UiFormField
        v-if="workspaceStore.workspaceProviderId === 'tauri'"
        :label="t('fastcat.projects.projectLocation')"
      >
        <div class="flex gap-2 w-full">
          <UiTextInput v-model="duplicateLocation" readonly full-width class="flex-1" />
          <UButton
            color="neutral"
            variant="subtle"
            icon="i-heroicons-folder-open"
            @click="selectDuplicateLocation"
          />
        </div>
      </UiFormField>
    </div>

    <template #footer>
      <div class="flex justify-end gap-3 w-full">
        <UButton
          variant="ghost"
          color="neutral"
          :label="t('common.cancel')"
          @click="closeDuplicateModal"
        />
        <UButton
          color="primary"
          variant="solid"
          :disabled="!isDuplicateNameValid"
          :label="t('common.duplicate')"
          @click="confirmDuplicate"
        />
      </div>
    </template>
  </UiModal>

  <EditorSettingsModal v-model:open="isSettingsOpen" />

  <!-- Loading Overlay -->
  <div
    v-if="workspaceStore.isLoading || isTransitioning"
    class="absolute inset-0 z-[100] flex items-center justify-center bg-ui-bg/60 backdrop-blur-sm transition-all duration-300"
  >
    <div
      class="flex flex-col items-center gap-3 p-6 bg-ui-bg-elevated border border-ui-border rounded-2xl shadow-2xl"
    >
      <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-500"></div>
      <span class="text-sm font-medium text-ui-text-muted">{{ t('common.loading') }}</span>
    </div>
  </div>
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
