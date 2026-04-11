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
const isRecentExpanded = ref(false);

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
  workspaceStore.userSettings.projectPresets.items.map((preset: { id: string; name: string }) => ({
    value: preset.id,
    label: preset.name,
  })),
);

// Список последних проектов для Hero-секции
const recentProjects = computed(() => workspaceStore.recentProjects);

// Умная сортировка: сначала недавние (по дате), потом остальные (по алфавиту)
const smartSortedProjects = computed(() => {
  const recentNames = recentProjects.value.map((p: { projectName: string }) => p.projectName);
  const others = filteredProjects.value
    .filter((p: string) => !recentNames.includes(p))
    .sort((a: string, b: string) => a.localeCompare(b));

  return [
    ...recentProjects.value.filter((p: { projectName: string }) =>
      filteredProjects.value.includes(p.projectName),
    ),
    ...others.map((p: string) => ({
      projectName: p,
      projectId: undefined,
      lastTimelinePath: undefined,
      updatedAt: undefined,
    })),
  ];
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
      class="w-64 border-r border-ui-border bg-ui-bg-elevated/50 flex flex-col shrink-0 backdrop-blur-md"
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
        <div class="bg-ui-bg/50 rounded-xl p-3 border border-ui-border">
          <div class="flex items-center justify-between gap-2 mb-2">
            <span class="text-[10px] font-bold text-ui-text-muted uppercase tracking-wider">{{
              t('fastcat.projects.changeWorkspace')
            }}</span>
            <UButton
              variant="ghost"
              color="neutral"
              icon="i-heroicons-arrows-right-left"
              size="xs"
              class="h-6 w-6 p-0"
              @click="workspaceStore.resetWorkspace"
            />
          </div>
          <div class="flex items-center gap-2 overflow-hidden">
            <UIcon name="i-heroicons-folder" class="w-4 h-4 text-primary-400 shrink-0" />
            <p class="text-xs font-medium text-ui-text truncate">
              {{ workspaceStore.workspaceHandle?.name }}
            </p>
          </div>
        </div>

        <div class="space-y-1">
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
          <!-- Recent Projects Section -->
          <section v-if="recentProjects.length > 0">
            <div class="flex items-center justify-between mb-6">
              <h2 class="text-lg font-bold text-ui-text flex items-center gap-2">
                <UIcon name="i-heroicons-clock" class="text-primary-400" />
                {{ t('common.recent') }}
              </h2>
              <UButton
                variant="ghost"
                color="neutral"
                size="sm"
                :icon="isRecentExpanded ? 'i-heroicons-chevron-up' : 'i-heroicons-chevron-down'"
                :label="isRecentExpanded ? t('common.collapse') : t('common.expand')"
                class="hover:bg-ui-bg-accent rounded-lg"
                @click="isRecentExpanded = !isRecentExpanded"
              />
            </div>

            <div
              class="transition-all duration-300 ease-in-out"
              :class="
                isRecentExpanded
                  ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
                  : 'flex gap-6 overflow-x-auto pb-4 custom-scrollbar snap-x'
              "
            >
              <div
                v-for="(project, index) in isRecentExpanded
                  ? recentProjects
                  : recentProjects.slice(0, 10)"
                :key="project.projectName"
                class="group relative bg-ui-bg-elevated rounded-2xl overflow-hidden transition-all cursor-pointer shadow-xl hover:-translate-y-1 snap-start"
                :class="[
                  index === 0 && !isRecentExpanded
                    ? 'border-2 border-selection-accent-500/60 hover:border-selection-accent-500 shadow-selection-accent-500/10'
                    : 'border border-ui-border hover:border-selection-accent-500/50 hover:shadow-selection-accent-500/5',
                  !isRecentExpanded ? 'w-[400px] shrink-0' : 'w-full',
                ]"
                @click="handleOpenProject(project.projectName)"
              >
                <div class="aspect-video relative overflow-hidden">
                  <ProjectThumbnail
                    :project-id="project.projectId"
                    :project-relative-path="project.lastTimelinePath"
                    :project-name="project.projectName"
                  />
                  <div
                    class="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-40 transition-opacity"
                  />
                  <div class="absolute bottom-4 left-4 right-4">
                    <h3 class="text-white font-bold text-lg truncate mb-1">
                      {{ project.projectName }}
                    </h3>
                    <p class="text-white/60 text-xs flex items-center gap-1.5">
                      <UIcon name="i-heroicons-calendar" class="w-3.5 h-3.5" />
                      {{ formatDate(project.updatedAt) }}
                    </p>
                  </div>
                  <div
                    class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all scale-90 group-hover:scale-100"
                  >
                    <div
                      class="w-12 h-12 rounded-full bg-primary-500 flex items-center justify-center shadow-2xl"
                    >
                      <UIcon name="i-heroicons-play-solid" class="w-6 h-6 text-white" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- All Projects Grid -->
          <section>
            <div class="flex items-center justify-between mb-6">
              <h2 class="text-lg font-bold text-ui-text flex items-center gap-2">
                <UIcon name="lucide:box" class="text-primary-400" />
                {{ t('fastcat.projects.title') }}
                <span class="text-ui-text-muted font-normal text-sm ml-2"
                  >({{ smartSortedProjects.length }})</span
                >
              </h2>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              <!-- Projects -->
              <div
                v-for="project in smartSortedProjects"
                :key="project.projectName"
                class="flex flex-col group bg-ui-bg-elevated/50 border border-ui-border rounded-xl overflow-hidden hover:border-primary-500/50 hover:bg-ui-bg-accent transition-all cursor-pointer"
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
                  <div
                    class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    <UButton
                      size="xs"
                      color="primary"
                      icon="i-heroicons-arrow-right"
                      :label="t('common.open')"
                      class="rounded-full"
                    />
                  </div>
                </div>

                <div class="p-3 flex flex-col flex-1 min-h-[74px]">
                  <div v-if="isRenaming === project.projectName" class="mb-2">
                    <UiTextInput
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
                    <UButton
                      v-if="isRenaming !== project.projectName"
                      size="xs"
                      variant="ghost"
                      color="neutral"
                      icon="lucide:edit-2"
                      class="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      @click.stop="startRename(project.projectName)"
                    />
                  </div>
                </div>
              </div>

              <!-- Create Card inside grid -->
              <div
                class="flex flex-col group bg-ui-bg-elevated/30 border border-dashed border-ui-border rounded-xl overflow-hidden hover:border-ui-action/50 hover:bg-ui-action/5 transition-all cursor-pointer"
                @click="startCreateProject"
              >
                <div
                  class="aspect-video relative bg-ui-bg-accent/50 flex items-center justify-center shrink-0"
                >
                  <div
                    class="w-10 h-10 rounded-full bg-ui-bg-accent flex items-center justify-center group-hover:bg-ui-action/20 transition-colors"
                  >
                    <UIcon
                      name="i-heroicons-plus"
                      class="w-5 h-5 text-ui-text-muted group-hover:text-ui-action"
                    />
                  </div>
                </div>
                <div class="p-3 flex flex-col flex-1 min-h-[74px]">
                  <h3
                    class="text-sm font-semibold text-ui-text-muted group-hover:text-ui-action truncate"
                  >
                    {{ t('fastcat.projects.newProject') }}
                  </h3>
                  <div
                    class="flex items-center justify-between mt-auto pt-2 border-t border-transparent h-8"
                  >
                    <!-- Spacer to match project card layout -->
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
