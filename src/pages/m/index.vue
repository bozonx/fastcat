<script setup lang="ts">
import { useWorkspaceStore } from '~/stores/workspace.store';
import { useProjectActions } from '~/composables/editor/useProjectActions';
import { useProjectManagement } from '~/composables/project/useProjectManagement';
import WelcomeScreen from '~/components/startup/WelcomeScreen.vue';
import UiModal from '~/components/ui/UiModal.vue';
import UiSelect from '~/components/ui/UiSelect.vue';
import UiSearchInput from '~/components/ui/UiSearchInput.vue';
import MediaResolutionSettings from '~/components/media/MediaResolutionSettings.vue';
import ProjectThumbnail from '~/components/startup/ProjectThumbnail.vue';
import MobileSettingsView from '~/components/settings/MobileSettingsView.vue';
import UiMobileDrawer from '~/components/ui/UiMobileDrawer.vue';
import UiFormField from '~/components/ui/UiFormField.vue';
import MobileBottomNav from '~/components/layout/MobileBottomNav.vue';

definePageMeta({
  layout: 'mobile',
});

const { t, locale } = useI18n();
const router = useRouter();
const workspaceStore = useWorkspaceStore();
const { resetProjectState } = useProjectActions();

// Сбрасываем состояние открытого проекта при попадании на список
resetProjectState();

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
} = useProjectManagement({ isMobile: true });

const isSettingsOpen = ref(false);

const projectPresetOptions = computed(() =>
  workspaceStore.userSettings.projectPresets.items.map((preset: { id: string; name: string }) => ({
    value: preset.id,
    label: preset.name,
  })),
);

// Сортировка для основного списка по дате изменения (сначала новые)
const sortedProjects = computed(() => {
  const recentMap = new Map(workspaceStore.recentProjects.map((p) => [p.projectName, p]));
  const projects = filteredProjects.value.map((name) => {
    const recent = recentMap.get(name);
    return {
      projectName: name,
      projectId: recent?.projectId,
      lastTimelinePath: recent?.lastTimelinePath,
      updatedAt: recent?.updatedAt,
    };
  });

  projects.sort((a, b) => {
    const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
    const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
    if (dateA === dateB) {
      return a.projectName.localeCompare(b.projectName);
    }
    return dateB - dateA;
  });

  return projects;
});

const formatDate = (dateStr?: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat(locale.value, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};
</script>

<template>
  <div class="h-screen w-full">
    <!-- Если рабочая область не выбрана -->
    <WelcomeScreen v-if="!workspaceStore.workspaceHandle" />

    <template v-else>
      <div class="flex h-screen w-full flex-col bg-ui-bg overflow-hidden text-ui-text font-sans">
        <!-- Sticky Header with Glass Effect -->
        <header
          class="shrink-0 pt-safe px-5 pb-4 bg-ui-bg/80 backdrop-blur-xl border-b border-white/5 z-20"
        >
          <div class="flex items-center justify-between h-14">
            <div class="flex flex-col min-w-0">
              <h1 class="text-xl font-black tracking-tight text-white uppercase italic truncate">
                FastCat <span class="text-primary-500 not-italic">Editor</span>
              </h1>
              <div
                class="flex items-center gap-1 text-[10px] text-ui-text-muted font-bold uppercase tracking-widest"
              >
                <UIcon name="i-heroicons-folder" class="w-3 h-3" />
                <span class="truncate max-w-[120px]">{{
                  workspaceStore.workspaceHandle.name
                }}</span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UButton
                size="sm"
                variant="ghost"
                color="neutral"
                icon="i-heroicons-computer-desktop"
                class="rounded-full w-10 h-10 p-0 flex items-center justify-center bg-white/5 text-ui-text-muted"
                @click="router.push('/')"
              />
              <UButton
                size="sm"
                variant="ghost"
                color="neutral"
                icon="i-heroicons-cog-6-tooth"
                class="rounded-full w-10 h-10 p-0 flex items-center justify-center bg-white/5"
                @click="isSettingsOpen = true"
              />
            </div>
          </div>
        </header>

        <!-- Main Content -->
        <main class="flex-1 overflow-y-auto bg-ui-bg custom-scrollbar relative">
          <!-- Search Bar Sticky below header -->
          <div class="px-5 py-4 sticky top-0 z-10 bg-ui-bg/80 backdrop-blur-md">
            <UiSearchInput
              v-model="searchQuery"
              :placeholder="t('fastcat.projects.searchPlaceholder')"
              is-mobile
            />
          </div>

          <div class="flex flex-col gap-8 pb-24">
            <!-- New Project Button -->
            <div class="px-5">
              <UButton
                block
                size="xl"
                color="primary"
                icon="i-heroicons-plus"
                class="shadow-lg shadow-ui-action/20 py-4 rounded-2xl font-bold uppercase tracking-wide bg-ui-action! hover:bg-ui-action-hover! text-white! border-none transition-all active:scale-[0.98]"
                @click="startCreateProject"
              >
                {{ t('fastcat.projects.newProject') }}
              </UButton>
            </div>

            <!-- All Projects List -->
            <section class="space-y-4 px-5">
              <div class="flex items-center justify-between">
                <h2 class="text-[11px] font-black uppercase tracking-[0.2em] text-ui-text-muted">
                  {{ searchQuery ? t('common.found') : t('fastcat.projects.title') }}
                </h2>
                <span
                  class="text-[10px] font-bold text-primary-500 bg-primary-500/10 px-2 py-0.5 rounded-full uppercase"
                >
                  {{ filteredProjects.length }}
                </span>
              </div>

              <div v-if="filteredProjects.length > 0" class="flex flex-col gap-3">
                <div
                  v-for="project in sortedProjects"
                  :key="project.projectName"
                  class="group bg-ui-bg-elevated/40 border border-white/5 rounded-2xl overflow-hidden flex items-center active:bg-ui-bg-elevated transition-all shadow-sm h-20"
                  @click="handleOpenProject(project.projectName)"
                >
                  <div class="w-20 h-full relative shrink-0">
                    <ProjectThumbnail
                      :project-id="project.projectId"
                      :project-relative-path="project.lastTimelinePath"
                      :project-name="project.projectName"
                      variant="mobile"
                    />
                    <div class="absolute inset-0 bg-black/20" />
                  </div>

                  <div class="px-4 flex items-center justify-between flex-1 min-w-0 h-full">
                    <div class="flex flex-col min-w-0">
                      <span
                        class="font-bold text-ui-text truncate text-sm tracking-tight leading-tight"
                        >{{ project.projectName }}</span
                      >
                      <span
                        class="text-[10px] text-ui-text-muted font-medium flex items-center gap-1 mt-1"
                      >
                        <UIcon name="i-heroicons-clock" class="w-3 h-3" />
                        {{ project.updatedAt ? formatDate(project.updatedAt) : '---' }}
                      </span>
                    </div>

                    <div class="flex items-center gap-2 shrink-0">
                      <UButton
                        size="sm"
                        variant="ghost"
                        color="neutral"
                        icon="lucide:edit-2"
                        class="rounded-full w-9 h-9 p-0 text-ui-text-muted active:text-white active:bg-white/5 transition-colors"
                        @click.stop="startRename(project.projectName)"
                      />
                      <UButton
                        size="sm"
                        variant="ghost"
                        color="neutral"
                        icon="i-heroicons-trash"
                        class="rounded-full w-9 h-9 p-0 text-ui-text-muted active:text-white active:bg-white/5 transition-colors"
                        @click.stop="startDelete(project.projectName)"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <!-- Empty State -->
              <div
                v-else
                class="flex flex-col items-center justify-center py-24 text-ui-text-muted gap-8"
              >
                <div
                  class="w-28 h-28 rounded-full bg-ui-bg-elevated/50 flex items-center justify-center border border-white/5 relative"
                >
                  <UIcon name="i-heroicons-folder-open" class="w-12 h-12 opacity-10" />
                  <div class="absolute inset-0 bg-primary-500/5 rounded-full animate-pulse" />
                </div>
                <div class="text-center space-y-3">
                  <p class="font-black uppercase tracking-[0.2em] text-[10px] text-ui-text-muted">
                    {{ t('fastcat.projects.noProjectsFound') }}
                  </p>
                  <UButton
                    variant="solid"
                    color="neutral"
                    size="sm"
                    class="rounded-full px-6 bg-ui-action! hover:bg-ui-action-hover! text-white! border-none shadow-ui-action/20"
                    :label="t('fastcat.projects.newProject')"
                    @click="startCreateProject"
                  />
                </div>
              </div>
            </section>
          </div>
        </main>

        <!-- Bottom Navigation Bar -->
        <MobileBottomNav />

        <!-- Error Toast Overlay -->
        <div v-if="workspaceStore.error" class="fixed bottom-24 left-5 right-5 z-50 animate-bounce">
          <div
            class="bg-red-500/90 backdrop-blur-md text-white text-[11px] font-bold p-4 rounded-2xl shadow-2xl flex items-center gap-3 border border-red-400/20"
          >
            <UIcon name="i-heroicons-exclamation-triangle" class="w-5 h-5" />
            {{ workspaceStore.error }}
          </div>
        </div>
      </div>

      <!-- Create Project Modal (iOS Style Sheet) -->
      <UiModal
        v-model:open="isCreateModalOpen"
        :title="t('fastcat.projects.newProject')"
        :ui="{
          content:
            'max-w-full m-0 rounded-t-[2.5rem] rounded-b-none fixed bottom-0 top-auto h-auto min-h-[50vh] bg-ui-bg border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]',
          body: 'pb-12 pt-8 px-6',
          header: 'pt-6 px-6 border-none',
        }"
      >
        <div class="space-y-8">
          <UiFormField :label="t('fastcat.projects.projectNamePlaceholder')">
            <UiTextInput
              v-model="projectCreationSettings.name"
              :placeholder="t('fastcat.projects.projectNamePlaceholder')"
              variant="none"
              full-width
              :ui="{
                base: 'h-16 text-xl font-bold px-6 bg-ui-bg-elevated/50 border border-white/5 rounded-3xl focus:ring-2 focus:ring-primary-500 transition-all placeholder:text-ui-text-muted',
              }"
              autofocus
              @keyup.enter="createNewProject"
            />
          </UiFormField>

          <div
            v-if="!projectCreationSettings.isAdvancedSettingsOpen"
            class="text-[11px] text-ui-text-muted bg-ui-bg-elevated/30 p-5 rounded-3xl flex gap-4 border border-white/5 leading-relaxed"
          >
            <UIcon
              name="i-heroicons-information-circle"
              class="w-5 h-5 shrink-0 text-primary-500"
            />
            <p>
              {{
                t(
                  'fastcat.projects.autoDetectHint',
                  'Project resolution and framerate will be automatically detected from the first video added to the timeline.',
                )
              }}
            </p>
          </div>

          <UCollapsible v-model:open="projectCreationSettings.isAdvancedSettingsOpen">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              class="p-0 hover:bg-transparent text-ui-text-muted font-black uppercase tracking-[0.2em] text-[10px]"
              :icon="
                projectCreationSettings.isAdvancedSettingsOpen
                  ? 'i-heroicons-chevron-down-20-solid'
                  : 'i-heroicons-chevron-right-20-solid'
              "
              :label="t('videoEditor.projectSettings.advanced')"
            />

            <template #content>
              <div class="pt-8 border-t border-white/5 mt-6 space-y-8">
                <UiFormField :label="t('videoEditor.export.presetLabel')">
                  <UiSelect
                    v-model="projectCreationSettings.presetId"
                    :items="projectPresetOptions"
                    value-key="value"
                    label-key="label"
                    full-width
                    class="bg-ui-bg-elevated/50! rounded-2xl! h-12!"
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
          <div class="flex gap-4 w-full pb-safe mt-4">
            <UButton
              variant="ghost"
              color="neutral"
              class="flex-1 h-16 rounded-[1.5rem] font-bold text-ui-text-muted active:bg-white/5"
              :label="t('common.cancel')"
              @click="isCreateModalOpen = false"
            />
            <UButton
              color="primary"
              class="flex-2 h-16 rounded-[1.5rem] font-black uppercase tracking-[0.2em] text-xs shadow-2xl shadow-primary-500/20 active:scale-95 transition-transform"
              :disabled="!projectCreationSettings.name.trim()"
              :loading="workspaceStore.isLoading"
              :label="t('common.create')"
              @click="createNewProject"
            />
          </div>
        </template>
      </UiModal>

      <!-- Settings Drawer -->
      <UiMobileDrawer v-model:open="isSettingsOpen" :title="t('videoEditor.settings.title')">
        <MobileSettingsView hide-title />
      </UiMobileDrawer>

      <!-- Rename Project Modal (iOS Style Sheet) -->
      <UiModal
        v-model:open="isRenameModalOpen"
        :title="t('common.rename')"
        :ui="{
          content:
            'max-w-full m-0 rounded-t-[2.5rem] rounded-b-none fixed bottom-0 top-auto h-auto min-h-[40vh] bg-ui-bg border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]',
          body: 'pb-12 pt-8 px-6',
          header: 'pt-6 px-6 border-none',
        }"
      >
        <div class="space-y-8">
          <UiFormField :label="t('fastcat.projects.projectNamePlaceholder')">
            <UiTextInput
              v-model="renameValue"
              :placeholder="t('fastcat.projects.projectNamePlaceholder')"
              variant="none"
              full-width
              :ui="{
                base: 'h-16 text-xl font-bold px-6 bg-ui-bg-elevated/50 border border-white/5 rounded-3xl focus:ring-2 focus:ring-primary-500 transition-all placeholder:text-ui-text-muted',
              }"
              autofocus
              @keyup.enter="renameProject"
            />
          </UiFormField>
        </div>

        <template #footer>
          <div class="flex gap-4 w-full pb-safe mt-4">
            <UButton
              variant="ghost"
              color="neutral"
              class="flex-1 h-16 rounded-[1.5rem] font-bold text-ui-text-muted active:bg-white/5"
              :label="t('common.cancel')"
              @click="isRenameModalOpen = false"
            />
            <UButton
              color="primary"
              class="flex-2 h-16 rounded-[1.5rem] font-black uppercase tracking-[0.2em] text-xs shadow-2xl shadow-primary-500/20 active:scale-95 transition-transform"
              :disabled="!renameValue.trim()"
              :label="t('common.rename')"
              @click="renameProject"
            />
          </div>
        </template>
      </UiModal>

      <!-- Delete Project Confirmation Modal (iOS Style Sheet) -->
      <UiModal
        v-model:open="isDeleteModalOpen"
        :title="t('videoEditor.projectSettings.deleteProjectConfirmTitle')"
        :description="t('videoEditor.projectSettings.deleteProjectConfirmDescription')"
        :ui="{
          content:
            'max-w-full m-0 rounded-t-[2.5rem] rounded-b-none fixed bottom-0 top-auto h-auto min-h-[35vh] bg-ui-bg border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]',
          body: 'pb-12 pt-8 px-6',
          header: 'pt-6 px-6 border-none',
        }"
      >
        <template #footer>
          <div class="flex gap-4 w-full pb-safe mt-4">
            <UButton
              variant="ghost"
              color="neutral"
              class="flex-1 h-16 rounded-[1.5rem] font-bold text-ui-text-muted active:bg-white/5"
              :label="t('common.cancel')"
              @click="closeDeleteModal"
            />
            <UButton
              color="error"
              class="flex-2 h-16 rounded-[1.5rem] font-black uppercase tracking-[0.2em] text-xs shadow-2xl shadow-red-500/20 active:scale-95 transition-transform"
              :label="t('videoEditor.projectSettings.deleteProjectAction')"
              :loading="workspaceStore.isLoading"
              @click="confirmDelete"
            />
          </div>
        </template>
      </UiModal>
    </template>
  </div>
</template>

<style scoped>
.pt-safe {
  padding-top: env(safe-area-inset-top, 0);
}
.pb-safe {
  padding-bottom: env(safe-area-inset-bottom, 0);
}

.no-scrollbar::-webkit-scrollbar {
  display: none;
}
.no-scrollbar {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 3px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 10px;
}
</style>
