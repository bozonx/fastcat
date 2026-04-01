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
import MobileAppSettingsPanel from '~/components/settings/MobileAppSettingsPanel.vue';
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

const isSettingsOpen = ref(false);

const projectPresetOptions = computed(() =>
  workspaceStore.userSettings.projectPresets.items.map((preset: { id: string; name: string }) => ({
    value: preset.id,
    label: preset.name,
  })),
);

// Список последних проектов для Hero-секции
const recentProjects = computed(() => workspaceStore.recentProjects);

// Умная сортировка для основного списка
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
      <div
        class="flex h-screen w-full flex-col bg-slate-950 overflow-hidden text-slate-200 font-sans"
      >
        <!-- Sticky Header with Glass Effect -->
        <header
          class="shrink-0 pt-safe px-5 pb-4 bg-slate-950/80 backdrop-blur-xl border-b border-white/5 z-20"
        >
          <div class="flex items-center justify-between h-14">
            <div class="flex flex-col min-w-0">
              <h1 class="text-xl font-black tracking-tight text-white uppercase italic truncate">
                FastCat <span class="text-primary-500 not-italic">Editor</span>
              </h1>
              <div
                class="flex items-center gap-1 text-[10px] text-slate-500 font-bold uppercase tracking-widest"
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
                class="rounded-full w-10 h-10 p-0 flex items-center justify-center bg-white/5 text-slate-400"
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
        <main class="flex-1 overflow-y-auto bg-slate-950 custom-scrollbar relative">
          <!-- Search Bar Sticky below header -->
          <div class="px-5 py-4 sticky top-0 z-10 bg-slate-950/80 backdrop-blur-md">
              <UiSearchInput
                v-model="searchQuery"
                :placeholder="t('fastcat.projects.searchPlaceholder')"
                is-mobile
              />
          </div>

          <div class="flex flex-col gap-8 pb-24">
            <!-- Recent Projects Horizontal Scroll -->
            <section v-if="recentProjects.length > 0 && !searchQuery" class="space-y-4">
              <div class="px-5 flex items-center justify-between">
                <h2 class="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
                  {{ t('common.recent') }}
                </h2>
              </div>

              <div class="flex overflow-x-auto gap-4 px-5 pb-2 no-scrollbar scroll-smooth">
                <div
                  v-for="project in recentProjects.slice(0, 5)"
                  :key="project.projectName"
                  class="shrink-0 w-64 group relative active:scale-95 transition-transform duration-200"
                  @click="handleOpenProject(project.projectName)"
                >
                  <div
                    class="aspect-video rounded-3xl overflow-hidden border border-white/10 shadow-2xl relative bg-slate-900"
                  >
                    <ProjectThumbnail
                      :project-id="project.projectId"
                      :project-relative-path="project.lastTimelinePath"
                      :project-name="project.projectName"
                    />
                    <div
                      class="absolute inset-0 bg-linear-to-t from-black/90 via-black/20 to-transparent pointer-events-none"
                    />
                    <div class="absolute bottom-4 left-4 right-4">
                      <h3 class="font-bold text-white text-sm truncate">
                        {{ project.projectName }}
                      </h3>
                      <p
                        class="text-[10px] text-slate-400 font-medium mt-1 flex items-center gap-1"
                      >
                        <UIcon name="i-heroicons-calendar" class="w-3 h-3" />
                        {{ formatDate(project.updatedAt) }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- All Projects List -->
            <section class="space-y-4 px-5">
              <div class="flex items-center justify-between">
                <h2 class="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">
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
                  v-for="project in smartSortedProjects"
                  :key="project.projectName"
                  class="group bg-slate-900/40 border border-white/5 rounded-2xl overflow-hidden flex items-center active:bg-slate-800 transition-all shadow-sm h-20"
                  @click="
                    isRenaming === project.projectName
                      ? null
                      : handleOpenProject(project.projectName)
                  "
                >
                  <div class="w-24 h-full relative shrink-0">
                    <ProjectThumbnail
                      :project-id="project.projectId"
                      :project-relative-path="project.lastTimelinePath"
                      :project-name="project.projectName"
                    />
                    <div class="absolute inset-0 bg-black/20" />
                  </div>

                  <div class="px-4 flex items-center justify-between flex-1 min-w-0 h-full">
                    <div
                      v-if="isRenaming === project.projectName"
                      class="flex items-center gap-2 w-full pr-1"
                    >
                      <UInput
                        v-model="renameValue"
                        size="md"
                        class="flex-1 min-w-0"
                        autofocus
                        variant="none"
                        :ui="{
                          base: 'h-11 px-4 bg-slate-900 border border-white/10 rounded-2xl focus:border-primary-500/50 transition-all font-bold text-sm text-white focus:ring-0',
                        }"
                        @keyup.enter="renameProject(project.projectName)"
                        @keyup.esc="isRenaming = null"
                        @click.stop
                      />
                      <div class="flex items-center gap-1.5 shrink-0">
                        <UButton
                          size="md"
                          variant="solid"
                          color="primary"
                          icon="i-heroicons-check-20-solid"
                          class="rounded-2xl w-11 h-11 p-0 bg-ui-action! text-white shadow-lg shadow-ui-action/20 border-none active:scale-95 transition-all flex items-center justify-center"
                          @click.stop="renameProject(project.projectName)"
                        />
                        <UButton
                          size="md"
                          variant="solid"
                          color="neutral"
                          icon="i-heroicons-x-mark-20-solid"
                          class="rounded-2xl w-11 h-11 p-0 bg-white/5 border border-white/5 text-slate-400 hover:text-white active:scale-90 transition-all flex items-center justify-center"
                          @click.stop="isRenaming = null"
                        />
                      </div>
                    </div>

                    <template v-else>
                      <div class="flex flex-col min-w-0">
                        <span
                          class="font-bold text-slate-100 truncate text-sm tracking-tight leading-tight"
                          >{{ project.projectName }}</span
                        >
                        <span
                          class="text-[10px] text-slate-500 font-medium flex items-center gap-1 mt-1"
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
                          class="rounded-full w-9 h-9 p-0 text-slate-600 active:text-white active:bg-white/5 transition-colors"
                          @click.stop="startRename(project.projectName)"
                        />
                      </div>
                    </template>
                  </div>
                </div>
              </div>

              <!-- Empty State -->
              <div
                v-else
                class="flex flex-col items-center justify-center py-24 text-slate-600 gap-8"
              >
                <div
                  class="w-28 h-28 rounded-full bg-slate-900/50 flex items-center justify-center border border-white/5 relative"
                >
                  <UIcon name="i-heroicons-folder-open" class="w-12 h-12 opacity-10" />
                  <div class="absolute inset-0 bg-primary-500/5 rounded-full animate-pulse" />
                </div>
                <div class="text-center space-y-3">
                  <p class="font-black uppercase tracking-[0.2em] text-[10px] text-slate-500">
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
            'max-w-full m-0 rounded-t-[2.5rem] rounded-b-none fixed bottom-0 top-auto h-auto min-h-[50vh] bg-slate-950 border-t border-white/10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]',
          body: 'pb-12 pt-8 px-6',
          header: 'pt-6 px-6 border-none',
        }"
      >
        <div class="space-y-8">
          <UiFormField :label="t('fastcat.projects.projectNamePlaceholder')">
            <UInput
              v-model="projectCreationSettings.name"
              :placeholder="t('fastcat.projects.projectNamePlaceholder')"
              variant="none"
              class="bg-slate-900/50 border border-white/5 rounded-3xl h-16 text-xl font-bold px-6 focus:ring-2 focus:ring-primary-500 transition-all placeholder:text-slate-700"
              autofocus
              @keyup.enter="createNewProject"
            />
          </UiFormField>

          <div
            v-if="!projectCreationSettings.isAdvancedSettingsOpen"
            class="text-[11px] text-slate-500 bg-slate-900/30 p-5 rounded-3xl flex gap-4 border border-white/5 leading-relaxed"
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
              class="p-0 hover:bg-transparent text-slate-500 font-black uppercase tracking-[0.2em] text-[10px]"
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
                    class="bg-slate-900/50! rounded-2xl! h-12!"
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
              class="flex-1 h-16 rounded-[1.5rem] font-bold text-slate-500 active:bg-white/5"
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

      <!-- Fullscreen Settings -->
      <UiModal
        v-model:open="isSettingsOpen"
        :title="t('videoEditor.settings.title')"
        :ui="{
          content: 'max-w-full m-0 h-full rounded-none bg-slate-950',
          body: '!p-0 !overflow-hidden flex flex-col h-full',
          header: 'shrink-0 pt-safe bg-slate-950 border-b border-white/5',
          footer: 'hidden',
        }"
      >
        <MobileAppSettingsPanel class="flex-1" />
      </UiModal>

      <!-- FAB -->
      <Teleport to="body">
        <div class="fixed bottom-24 right-6 z-40 transition-all duration-300">
          <UButton
            icon="lucide:plus"
            size="xl"
            class="rounded-full shadow-2xl w-14 h-14 flex items-center justify-center bg-ui-action hover:bg-ui-action-hover text-white border-none shadow-ui-action/20"
            :ui="{ icon: 'w-7 h-7' }"
            :aria-label="t('fastcat.projects.newProject')"
            @click="startCreateProject"
          />
        </div>
      </Teleport>
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
