<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useProjectManagement } from '~/composables/project/useProjectManagement';
import WelcomeScreen from '~/components/startup/WelcomeScreen.vue';
import UiModal from '~/components/ui/UiModal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import ProjectThumbnail from '~/components/startup/ProjectThumbnail.vue';
import MobileAppSettingsPanel from '~/components/settings/MobileAppSettingsPanel.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import MobileBottomNav from '~/components/layout/MobileBottomNav.vue';

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
  applyProjectCreationPreset,
  handleOpenProject,
  renameProject,
  startRename,
} = useProjectManagement({ isMobile: true });

const isAdvancedOpen = ref(false);
const isSettingsOpen = ref(false);

const projectPresetOptions = computed(() =>
  workspaceStore.userSettings.projectPresets.items.map((preset: { id: string; name: string }) => ({
    value: preset.id,
    label: preset.name,
  })),
);

// Список последних проектов для Hero-секции и списка
const recentProjects = computed(() => workspaceStore.recentProjects);

const getRecentInfo = (name: string) =>
  recentProjects.value.find((p: { projectName: string }) => p.projectName === name);

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
    })),
  ];
});
</script>

<template>
  <!-- Если рабочая область не выбрана -->
  <WelcomeScreen v-if="!workspaceStore.workspaceHandle" />

  <div v-else class="flex h-screen w-full flex-col bg-slate-950 overflow-hidden">
    <!-- Main Content Scrollable Area -->
    <div class="flex-1 overflow-y-auto p-4 px-5">
      <div class="flex flex-col gap-6 pb-6 pt-2">
        <div class="flex items-center justify-between">
          <h1 class="text-2xl font-bold text-white">{{ t('fastcat.projects.title') }}</h1>
          <div class="flex gap-1">
            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              icon="i-heroicons-cog-6-tooth"
              @click="isSettingsOpen = true"
            />
            <UButton
              size="sm"
              variant="ghost"
              color="neutral"
              icon="lucide:monitor"
              to="/?mode=desktop"
              :label="t('fastcat.projects.switchToDesktop')"
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
            >{{ t('fastcat.projects.title') }}: {{ workspaceStore.workspaceHandle.name }}</span
          >
          <UButton size="xs" variant="link" color="primary" @click="workspaceStore.resetWorkspace">
            {{ t('fastcat.projects.changeWorkspace') }}
          </UButton>
        </div>

        <!-- Project List -->
        <div class="space-y-4">
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
                {{ t('fastcat.projects.newProject') }}
              </h3>
            </div>
            <UIcon name="i-heroicons-chevron-right" class="w-5 h-5 text-slate-600" />
          </div>

          <div v-if="workspaceStore.error" class="text-red-400 text-sm">
            {{ workspaceStore.error }}
          </div>

          <!-- Search -->
          <UiSearchInput
            v-model="searchQuery"
            :placeholder="t('fastcat.projects.searchPlaceholder')"
            class="mb-2"
          />

          <div v-if="filteredProjects.length > 0" class="flex flex-col gap-3">
            <div
              v-for="project in smartSortedProjects"
              :key="project.projectName"
              class="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden flex items-center active:bg-slate-800 active:scale-[0.98] transition-all shadow-sm"
              @click="
                isRenaming === project.projectName ? null : handleOpenProject(project.projectName)
              "
            >
              <div class="w-24 aspect-video relative shrink-0">
                <ProjectThumbnail
                  :project-id="project.projectId"
                  :project-relative-path="project.lastTimelinePath"
                  :project-name="project.projectName"
                />
              </div>

              <div class="px-4 py-3 flex items-center justify-between flex-1 min-w-0">
                <div class="flex flex-col min-w-0">
                  <div v-if="isRenaming === project.projectName" class="flex gap-2">
                    <UInput
                      v-model="renameValue"
                      size="sm"
                      class="w-32"
                      autofocus
                      @keyup.enter="renameProject(project.projectName)"
                      @keyup.esc="isRenaming = null"
                      @click.stop
                    />
                    <UButton
                      size="xs"
                      color="primary"
                      icon="lucide:check"
                      @click.stop="renameProject(project.projectName)"
                    />
                  </div>
                  <span v-else class="font-medium text-slate-200 truncate">{{
                    project.projectName
                  }}</span>
                  <span v-if="project.projectId" class="text-2xs text-slate-500">
                    {{ t('fastcat.projects.recent') }}
                  </span>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                  <UButton
                    v-if="isRenaming !== project.projectName"
                    size="sm"
                    variant="ghost"
                    color="neutral"
                    icon="lucide:edit-2"
                    @click.stop="startRename(project.projectName)"
                  />
                  <Icon
                    v-if="isRenaming !== project.projectName"
                    name="lucide:chevron-right"
                    class="w-5 h-5 text-slate-600 shrink-0"
                  />
                </div>
              </div>
            </div>
          </div>

          <div v-else class="flex flex-col items-center justify-center py-16 text-slate-500 gap-4">
            <div class="w-20 h-20 rounded-full bg-slate-900 flex items-center justify-center">
              <Icon name="lucide:folder-open" class="w-10 h-10 opacity-20" />
            </div>
            <div class="text-center">
              <p class="font-medium">{{ t('fastcat.projects.noProjectsFound') }}</p>
              <p class="text-sm opacity-60">{{ t('fastcat.projects.newProject') }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Bottom Navigation Bar -->
    <MobileBottomNav />
  </div>

  <UiModal
    v-model:open="isCreateModalOpen"
    :title="t('fastcat.projects.newProject')"
    :ui="{ content: 'sm:max-w-lg max-h-[90vh]', body: 'overflow-y-auto' }"
  >
    <div class="space-y-6">
      <UiFormField :label="t('fastcat.projects.projectNamePlaceholder')">
        <UInput
          v-model="projectCreationSettings.name"
          :placeholder="t('fastcat.projects.projectNamePlaceholder')"
          autofocus
          @keyup.enter="createNewProject"
        />
      </UiFormField>

      <div
        v-if="!projectCreationSettings.isAdvancedSettingsOpen"
        class="text-xs text-slate-400 bg-slate-900/50 p-3 rounded-lg flex gap-2"
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
          <div class="pt-4 border-t border-slate-800 mt-2">
            <UiFormField :label="t('videoEditor.export.presetLabel', 'Preset')" class="mb-4">
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

  <UiModal
    v-model:open="isSettingsOpen"
    :title="t('videoEditor.settings.title')"
    :ui="{
      content: 'sm:max-w-2xl h-[95dvh]',
      body: '!p-0 !overflow-hidden flex flex-col',
    }"
  >
    <MobileAppSettingsPanel class="h-full" />
  </UiModal>
</template>
